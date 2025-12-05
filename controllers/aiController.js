require("dotenv").config(); 

exports.generateText = async (req, res) => {
  try {
    const { prompt } = req.body;

    // Validate input
    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const url = process.env.AI_URL || 'https://text.pollinations.ai/openai';
    
    const payload = {
      messages: [
        {
          role: 'system',
          content: 'You are a helpful coding assistant. Help users with code explanations, debugging, and suggestions.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      model: 'openai',
      seed: Math.floor(Math.random() * 999999999),
      jsonMode: false,
      private: true,
      stream: false
    };

    // Make request to Pollinations AI
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Pollinations API returned status ${response.status}`);
    }

    const result = await response.json();

    // Extract content from response
    if (result?.choices?.[0]?.message?.content) {
      return res.json({
        success: true,
        content: result.choices[0].message.content
      });
    } else {
      console.warn('Unexpected response structure:', result);
      return res.status(500).json({ 
        error: 'Unexpected response format from AI service' 
      });
    }

  } catch (error) {
    console.error('Pollinations AI error:', error);
    return res.status(500).json({ 
      error: 'Failed to generate AI response',
      details: error.message 
    });
  }
};
