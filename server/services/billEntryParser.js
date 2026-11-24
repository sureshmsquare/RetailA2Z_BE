import { AppError } from '../utils/AppError.js';
import billingConfig from '../config/billingConfig.js';

export const KNOWN_UNIT_TOKENS = {
  pc: 'UNIT',
  pcs: 'UNIT',
  piece: 'UNIT',
  pieces: 'UNIT',
  no: 'UNIT',
  nos: 'UNIT',
  unit: 'UNIT',
  units: 'UNIT',
  mtr: 'UNIT',
  m: 'UNIT',
  meter: 'UNIT',
  metre: 'UNIT',
  meters: 'UNIT',
  metres: 'UNIT',
  box: 'PACK',
  boxes: 'PACK',
  pack: 'PACK',
  packs: 'PACK',
  pkt: 'PACK',
  bag: 'PACK',
  bags: 'PACK',
  carton: 'PACK',
  cartons: 'PACK',
  ctn: 'PACK',
  bundle: 'PACK',
};

/**
 * Normalizes a unit token. Returns 'UNIT', 'PACK', or the raw trimmed string for unknown tokens.
 */
export function normalizeUnitToken(token) {
  if (!token) return 'UNIT';
  const clean = String(token).trim().toLowerCase();
  if (KNOWN_UNIT_TOKENS[clean]) {
    return KNOWN_UNIT_TOKENS[clean];
  }
  return clean;
}

/**
 * Checks if a string is a valid numeric quantity candidate (e.g. 2, 2.5, 0.333).
 */
function isNumericString(str) {
  if (!str) return false;
  return /^[+-]?\d+(\.\d+)?$/.test(str.trim());
}

/**
 * Checks if a token is a known unit.
 */
function isKnownUnitToken(token) {
  if (!token) return false;
  return Boolean(KNOWN_UNIT_TOKENS[String(token).trim().toLowerCase()]);
}

/**
 * Parses and validates quantity.
 * Returns { quantity: number | null, problem: null | 'invalid_quantity' }
 */
function parseQuantity(qtyStr) {
  if (qtyStr === null || qtyStr === undefined || qtyStr === '') {
    return { quantity: null, problem: null };
  }

  const trimmed = String(qtyStr).trim();
  const num = Number(trimmed);

  if (isNaN(num)) {
    return { quantity: null, problem: 'invalid_quantity' };
  }

  // Check decimals: maximum 3 decimals allowed
  if (trimmed.includes('.')) {
    const decParts = trimmed.split('.');
    if (decParts[1] && decParts[1].length > 3) {
      return { quantity: num, problem: 'invalid_quantity' };
    }
  }

  // Check positive and max limit
  const maxQty = billingConfig.MAX_QUANTITY || 999999.999;
  if (num <= 0 || num > maxQty) {
    return { quantity: num, problem: 'invalid_quantity' };
  }

  return { quantity: num, problem: null };
}

/**
 * Parses a single line/entry string into its constituent parts.
 */
function parseSingleEntry(inputText) {
  const trimmed = inputText.trim();
  if (!trimmed) return null;

  // Pattern A: Split by explicit operator
  // Operators:
  // - " - " (space-dash-space, since dashes without spaces are part of product codes like PVC-050-6M)
  // - " * ", " = ", " : ", " × " (with optional spaces)
  // - " x " or " X " (with whitespace or between digits like 96000001X2 or 96000001 X2)
  let normalized = trimmed;

  // Replace space-dash-space with a canonical separator ' | '
  normalized = normalized.replace(/\s+-\s+/g, ' | ');
  // Replace * : = × with ' | '
  normalized = normalized.replace(/\s*[\*:=×]\s*/g, ' | ');
  // Replace whitespace x/X with whitespace (e.g. 96000001 x 2 or 2 x 96000001)
  normalized = normalized.replace(/\s+[xX]\s+/g, ' | ');
  // Replace digit x/X digit with ' | ' (e.g. 96000001X2 or 96000001x2)
  normalized = normalized.replace(/(\d)[xX](\d)/g, '$1 | $2');
  // Replace whitespace x/X followed by digit (e.g. 96000001 X2)
  normalized = normalized.replace(/\s+[xX](\d)/g, ' | $1');
  // Replace digit followed by x/X with whitespace (e.g. 2x 96000001)
  normalized = normalized.replace(/(\d)[xX]\s+/g, '$1 | ');

  const segments = normalized.split(' | ').map((s) => s.trim()).filter(Boolean);

  let codeText = null;
  let rawQty = null;
  let rawUnit = null;
  let problem = null;

  if (segments.length === 2) {
    const left = segments[0];
    const right = segments[1];

    const leftTokens = left.split(/\s+/);
    const rightTokens = right.split(/\s+/);

    if (isNumericString(leftTokens[0]) && !isNumericString(rightTokens[0])) {
      // Reverse form: "2 x PVC-050-6M" or "2.5 mtr x 96000001" or "2 box 96000001"
      rawQty = leftTokens[0];
      if (leftTokens.length > 1) {
        rawUnit = leftTokens.slice(1).join(' ');
      }
      codeText = right;
    } else if (isNumericString(rightTokens[0]) && !isNumericString(leftTokens[0])) {
      // Standard form: "PVC-050-6M x 2" or "PVC-050-6M x 2.5 mtr"
      codeText = left;
      rawQty = rightTokens[0];
      if (rightTokens.length > 1) {
        rawUnit = rightTokens.slice(1).join(' ');
      }
    } else if (isNumericString(leftTokens[0]) && isNumericString(rightTokens[0])) {
      // Both start with numeric digits! E.g. "96000001 x 2" vs "2 x 96000001"
      const numLeft = Number(leftTokens[0]);
      const numRight = Number(rightTokens[0]);

      if (numLeft > 999999 || leftTokens[0].length >= 7) {
        // Left is code: "96000001 x 2"
        codeText = left;
        rawQty = rightTokens[0];
        if (rightTokens.length > 1) {
          rawUnit = rightTokens.slice(1).join(' ');
        }
      } else if (numRight > 999999 || rightTokens[0].length >= 7) {
        // Right is code: "2 x 96000001"
        codeText = right;
        rawQty = leftTokens[0];
        if (leftTokens.length > 1) {
          rawUnit = leftTokens.slice(1).join(' ');
        }
      } else {
        // Default standard form: left is code, right is qty
        codeText = left;
        rawQty = rightTokens[0];
        if (rightTokens.length > 1) {
          rawUnit = rightTokens.slice(1).join(' ');
        }
      }
    } else {
      codeText = left;
      rawQty = right;
    }
  } else if (segments.length === 1) {
    const tokens = segments[0].split(/\s+/);

    if (tokens.length === 1) {
      const token = tokens[0];
      if (/^[a-zA-Z0-9.\-\/]+$/.test(token)) {
        codeText = token;
        problem = 'missing_quantity';
      } else {
        return {
          inputText,
          codeText: token,
          quantity: null,
          unitToken: 'UNIT',
          problem: 'unreadable',
        };
      }
    } else if (tokens.length === 2) {
      // Form: "96000001 2" or "2 96000001" or "PVC-050-6M 3" or "3 PVC-050-6M"
      if (isNumericString(tokens[0]) && !isNumericString(tokens[1])) {
        // "3 PVC-050-6M"
        rawQty = tokens[0];
        codeText = tokens[1];
      } else if (!isNumericString(tokens[0]) && isNumericString(tokens[1])) {
        // "PVC-050-6M 3"
        codeText = tokens[0];
        rawQty = tokens[1];
      } else if (isNumericString(tokens[0]) && isNumericString(tokens[1])) {
        // "96000001 2" vs "2 96000001"
        if (tokens[0].length >= 7 || Number(tokens[0]) > 999999) {
          codeText = tokens[0];
          rawQty = tokens[1];
        } else if (tokens[1].length >= 7 || Number(tokens[1]) > 999999) {
          codeText = tokens[1];
          rawQty = tokens[0];
        } else {
          codeText = tokens[0];
          rawQty = tokens[1];
        }
      } else {
        codeText = tokens[0];
        rawQty = tokens[1];
      }
    } else if (tokens.length >= 3) {
      // 3 or more tokens:
      // Form 1: "96000001 2 box" -> tokens[0]=code, tokens[1]=qty, tokens[2]=unit
      // Form 2: "2 box 96000001" -> tokens[0]=qty, tokens[1]=unit, tokens[2]=code
      if (isNumericString(tokens[1])) {
        // "96000001 2 box" or "PVC-050-6M 2.5 mtr"
        codeText = tokens[0];
        rawQty = tokens[1];
        rawUnit = tokens.slice(2).join(' ');
      } else if (isNumericString(tokens[0])) {
        // "2 box 96000001" or "2.5 mtr PVC-050-6M"
        rawQty = tokens[0];
        codeText = tokens[tokens.length - 1];
        rawUnit = tokens.slice(1, -1).join(' ');
      } else {
        codeText = tokens[0];
        rawQty = tokens[1];
        rawUnit = tokens.slice(2).join(' ');
      }
    }
  } else {
    return {
      inputText,
      codeText: trimmed,
      quantity: null,
      unitToken: 'UNIT',
      problem: 'unreadable',
    };
  }

  // Validate codeText
  if (!codeText || !/^[a-zA-Z0-9.\-\/]+$/.test(codeText)) {
    return {
      inputText,
      codeText: codeText || trimmed,
      quantity: null,
      unitToken: 'UNIT',
      problem: 'unreadable',
    };
  }

  // If problem is already set (e.g. missing_quantity)
  if (problem === 'missing_quantity') {
    return {
      inputText,
      codeText,
      quantity: null,
      unitToken: 'UNIT',
      problem: 'missing_quantity',
    };
  }

  // Parse and validate quantity
  const { quantity, problem: qtyProblem } = parseQuantity(rawQty);
  if (qtyProblem) {
    return {
      inputText,
      codeText,
      quantity,
      unitToken: normalizeUnitToken(rawUnit),
      problem: qtyProblem,
    };
  }

  if (quantity === null) {
    return {
      inputText,
      codeText,
      quantity: null,
      unitToken: 'UNIT',
      problem: 'missing_quantity',
    };
  }

  const unitToken = normalizeUnitToken(rawUnit);

  return {
    inputText,
    codeText,
    quantity,
    unitToken,
    problem: null,
  };
}

/**
 * Pure function to parse raw text input into structured draft entries.
 * Splits by newlines, commas, and semicolons.
 *
 * @param {string} text - Raw input text from the user/client
 * @returns {Array<object>} Array of parsed entry objects
 */
export function parseEntryText(text) {
  if (!text || typeof text !== 'string') {
    return [];
  }

  const rawParts = text.split(/[\r\n,;]+/);
  const parts = rawParts.map((p) => p.trim()).filter(Boolean);

  if (parts.length > 100) {
    throw new AppError('Maximum 100 entries allowed per parse request', 400);
  }

  const entries = [];
  for (const part of parts) {
    const parsed = parseSingleEntry(part);
    if (parsed) {
      entries.push(parsed);
    }
  }

  return entries;
}

export default {
  parseEntryText,
  normalizeUnitToken,
  KNOWN_UNIT_TOKENS,
};
