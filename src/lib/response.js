const success = (res, data, message = 'Success', statusCode = 200) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
};

const error = (res, code, message, statusCode = 500, fields = null) => {
  const response = {
    success: false,
    error: {
      code,
      message,
    },
  };
  if (fields) response.error.fields = fields;
  return res.status(statusCode).json(response);
};

module.exports = { success, error };
