import multer from 'multer';
import path from 'path';
import { AppError } from '../utils/AppError.js';

// Memory storage keeps uploaded file buffer in memory for instant parsing
const storage = multer.memoryStorage();

// Supported MIME types and extensions for staged import
const ALLOWED_EXTENSIONS = ['.csv', '.xlsx', '.xls'];
const ALLOWED_MIME_TYPES = [
  'text/csv',
  'application/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/plain',
  'application/octet-stream', // Some browsers send XLSX as octet-stream
];

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();

  const isExtValid = ALLOWED_EXTENSIONS.includes(ext);
  const isMimeValid = ALLOWED_MIME_TYPES.includes(file.mimetype) || isExtValid;

  if (isExtValid && isMimeValid) {
    return cb(null, true);
  }

  return cb(
    new AppError('Invalid file format. Only CSV and Excel (.xlsx) files are allowed.', 400),
    false
  );
}

export const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB max
  },
  fileFilter,
});

export default upload;

