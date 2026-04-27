const { error } = require('../lib/response');

const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);

  if (!result.success) {
    const fieldErrors = result.error.flatten().fieldErrors;
    return error(res, 'VALIDATION_ERROR', 'Invalid request data', 400, fieldErrors);
  }

  req.body = result.data;
  next();
};

const validateQuery = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.query);

  if (!result.success) {
    const fieldErrors = result.error.flatten().fieldErrors;
    return error(res, 'VALIDATION_ERROR', 'Invalid query parameters', 400, fieldErrors);
  }

  req.query = result.data;
  next();
};

module.exports = { validate, validateQuery };
