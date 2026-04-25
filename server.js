require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { scrapeToMarkdown } = require('./scraper');

const app = express();

// 1. Dynamic Port for Cloud Deployment
// Render will inject its own port into process.env.PORT
const PORT = process.env.PORT || 10000;

// 2. Initialize Supabase
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

app.use(express.json());

// 3. The Main Scrape Route
app.get('/scrape', async (req, res) => {
    const targetUrl = req.query.url;
    const apiKey = req.headers['x-api-key'];

    // Security Check
    if (apiKey !== 'test-key-123') {
        return res.status(401).json({ error: 'Unauthorized: Invalid API Key' });
    }

    if (!targetUrl) {
        return res.status(400).json({ error: 'Please provide a URL parameter' });
    }

    try {
        console.log(`✅ Verified user: starting scrape for: ${targetUrl}`);

        // Run the scraper logic
        const markdown = await scrapeToMarkdown(targetUrl);

        // Save to Supabase
        const { data, error } = await supabase
            .from('scraped_data')
            .insert([{ 
                url: targetUrl, 
                content: markdown,
                created_at: new Date() 
            }]);

        if (error) throw error;

        // Return the markdown to the user
        res.json({
            success: true,
            message: "Data scraped and saved to Supabase",
            url: targetUrl,
            markdown: markdown
        });

    } catch (err) {
        console.error('❌ Scrape Error:', err.message);
        res.status(500).json({ error: 'Failed to scrape or save data', details: err.message });
    }
});

// 4. Start Server
// Using '0.0.0.0' allows Render's network to find your app container
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running at http://0.0.0.0:${PORT}`);
    console.log(`🔌 Connected to Supabase`);
});