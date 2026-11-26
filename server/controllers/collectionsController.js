import collectionsService from '../services/collectionsService.js';

export const listCustomers = async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const result = await collectionsService.listCollectionCustomers({
      storeId,
      query: req.query || {},
    });

    return res.status(200).json({
      success: true,
      data: result.data,
      summary: result.summary,
      pagination: result.pagination,
    });
  } catch (err) {
    next(err);
  }
};

export const listCustomerInvoices = async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const { customerId } = req.params;
    const result = await collectionsService.listCustomerOpenInvoices({
      storeId,
      customerId,
    });

    return res.status(200).json({
      success: true,
      data: result.invoices,
      customer: result.customer,
    });
  } catch (err) {
    next(err);
  }
};

export const recordReceipt = async (req, res, next) => {
  try {
    const storeId = req.storeId;
    const actor = req.user;
    const result = await collectionsService.recordReceipt({
      storeId,
      actor,
      payload: req.body || {},
    });

    return res.status(201).json({
      success: true,
      message: `Receipt ${result.receipt.receiptNumber} recorded successfully`,
      data: result.receipt,
      updatedInvoices: result.updatedInvoices,
    });
  } catch (err) {
    next(err);
  }
};

export default {
  listCustomers,
  listCustomerInvoices,
  recordReceipt,
};

