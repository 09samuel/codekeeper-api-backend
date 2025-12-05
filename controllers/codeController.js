const axios = require('axios');
require("dotenv").config(); 

exports.executeCode = async (req, res) => {
  try {
    const { language, version, code, stdin } = req.body;

    // Validate input
    if (!language || !code) {
      return res.status(400).json({ error: 'Language and code are required' });
    }

    // Prepare payload for Piston API
    const payload = {
      language: language,
      version: version || '*', // Use latest version if not specified
      files: [
        {
          name: 'main',
          content: code
        }
      ],
      stdin: stdin || '',
      args: [],
      compile_timeout: 10000,
      run_timeout: 3000,
      compile_memory_limit: -1,
      run_memory_limit: -1
    };

    console.log(`[Code Execution] Running ${language} code...`);

    // Call Piston API
    const response = await axios.post(
      process.env.CODE_RUNNER_URL || 'https://emkc.org/api/v2/piston/execute',
      payload,
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    const result = response.data;

    // Return execution result
    return res.json({
      success: true,
      output: result.run.output || result.run.stdout,
      stderr: result.run.stderr,
      exitCode: result.run.code,
      language: result.language,
      version: result.version
    });

  } catch (error) {
    console.error('[Code Execution] Error:', error.message);
    return res.status(500).json({
      error: 'Failed to execute code',
      details: error.response?.data?.message || error.message
    });
  }
};

exports.getRuntimes = async (req, res) => {
  try {
    console.log('[Runtimes] Fetching available runtimes...');
    const response = await axios.get('https://emkc.org/api/v2/piston/runtimes');
    
    // Return list of available languages
    return res.json({
      success: true,
      runtimes: response.data
    });

  } catch (error) {
    console.error('[Runtimes] Error:', error.message);
    return res.status(500).json({
      error: 'Failed to fetch runtimes',
      details: error.message
    });
  }
};
