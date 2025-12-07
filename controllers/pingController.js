exports.ping = (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'Service is alive',
    timestamp: new Date().toISOString()
  });
};
