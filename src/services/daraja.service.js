const axios = require('axios');
const logger = require('../lib/logger');

const SANDBOX_BASE = 'https://sandbox.safaricom.co.ke';
const PROD_BASE = 'https://api.safaricom.co.ke';

const BASE_URL = process.env.NODE_ENV === 'production' ? PROD_BASE : SANDBOX_BASE;

const getAccessToken = async () => {
  const key = process.env.DARAJA_CONSUMER_KEY;
  const secret = process.env.DARAJA_CONSUMER_SECRET;
  const credentials = Buffer.from(`${key}:${secret}`).toString('base64');

  const { data } = await axios.get(`${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${credentials}` },
    timeout: 10000,
  });

  return data.access_token;
};

const getTimestampAndPassword = () => {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:T.Z]/g, '')
    .slice(0, 14);
  const shortcode = process.env.DARAJA_SHORTCODE;
  const passkey = process.env.DARAJA_PASSKEY;
  const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
  return { timestamp, password };
};

const initiateSTKPush = async ({ phone, amount, rideId }) => {
  try {
    const token = await getAccessToken();
    const { timestamp, password } = getTimestampAndPassword();

    const formattedPhone = String(phone).replace(/^0/, '254').replace(/^\+/, '');

    const payload = {
      BusinessShortCode: process.env.DARAJA_SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.ceil(amount),
      PartyA: formattedPhone,
      PartyB: process.env.DARAJA_SHORTCODE,
      PhoneNumber: formattedPhone,
      CallBackURL: process.env.DARAJA_CALLBACK_URL,
      AccountReference: `RIDE-${rideId.slice(0, 8).toUpperCase()}`,
      TransactionDesc: 'Boda Moja Ride Payment',
    };

    const { data } = await axios.post(
      `${BASE_URL}/mpesa/stkpush/v1/processrequest`,
      payload,
      {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 15000,
      }
    );

    logger.info('STK Push initiated', {
      checkoutRequestId: data.CheckoutRequestID,
      rideId,
      phone: formattedPhone,
      amount,
    });

    return {
      checkoutRequestId: data.CheckoutRequestID,
      merchantRequestId: data.MerchantRequestID,
      responseCode: data.ResponseCode,
    };
  } catch (err) {
    logger.error('STK Push failed', {
      error: err.response?.data || err.message,
      rideId,
      phone,
      amount,
    });
    throw new Error(`STK Push failed: ${err.response?.data?.errorMessage || err.message}`);
  }
};

const querySTKStatus = async (checkoutRequestId) => {
  try {
    const token = await getAccessToken();
    const { timestamp, password } = getTimestampAndPassword();

    const { data } = await axios.post(
      `${BASE_URL}/mpesa/stkpushquery/v1/query`,
      {
        BusinessShortCode: process.env.DARAJA_SHORTCODE,
        Password: password,
        Timestamp: timestamp,
        CheckoutRequestID: checkoutRequestId,
      },
      {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 15000,
      }
    );

    return data;
  } catch (err) {
    logger.error('STK status query failed', {
      error: err.response?.data || err.message,
      checkoutRequestId,
    });
    throw new Error(`STK query failed: ${err.response?.data?.errorMessage || err.message}`);
  }
};

module.exports = { initiateSTKPush, querySTKStatus };
