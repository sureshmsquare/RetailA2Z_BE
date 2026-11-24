import salesService from '../services/salesService.js';

export const postDraft = async (req, res, next) => {
  try {
    const { id } = req.params;
    const storeId = req.storeId;
    const actor = req.user;
    const userRole = req.user?.role || 'admin';
    const paymentDetails = req.body || {};

    const result = await salesService.postDraftBill({
      storeId,
      draftId: id,
      actor,
      userRole,
      paymentDetails,
    });

    return res.status(201).json({
      success: true,
      message: result.isDuplicate ? 'Draft was already posted' : 'Bill posted successfully',
      data: result.invoice,
      receipt: result.receipt,
      isDuplicate: result.isDuplicate,
    });
  } catch (err) {
    next(err);
  }
};

export const getInvoice = async (req, res, next) => {
  try {
    const { id } = req.params;
    const storeId = req.storeId;
    const actor = req.user;
    const userRole = req.user?.role || 'admin';

    const invoice = await salesService.getInvoiceById({
      storeId,
      invoiceId: id,
      actor,
      userRole,
    });

    return res.status(200).json({
      success: true,
      data: invoice,
    });
  } catch (err) {
    next(err);
  }
};

export const listInvoices = async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const actor = req.user;
    const userRole = req.user?.role || 'admin';
    const query = req.query || {};

    const result = await salesService.listInvoices({
      storeId,
      actor,
      userRole,
      query,
    });

    return res.status(200).json({
      success: true,
      data: result.data,
      pagination: result.pagination,
    });
  } catch (err) {
    next(err);
  }
};

export const getInvoicePrint = async (req, res, next) => {
  try {
    const { id } = req.params;
    const storeId = req.storeId;
    const actor = req.user;
    const userRole = req.user?.role || 'admin';

    const printData = await salesService.getInvoicePrintData({
      storeId,
      invoiceId: id,
      actor,
      userRole,
    });

    return res.status(200).json({
      success: true,
      data: printData,
    });
  } catch (err) {
    next(err);
  }
};

export default {
  postDraft,
  getInvoice,
  listInvoices,
  getInvoicePrint,
};

