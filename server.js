require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { scrapeToMarkdown } = require('./scraper');

const app = express();
const PORT = process.env.PORT || 10000;

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

app.use(express.json());

app.get('/scrape', async (req, res) => {
    const targetUrl = req.query.url;
    const apiKey = req.headers['x-api-key'];

    if (!targetUrl || !apiKey) {
        return res.status(400).json({ error: 'Missing URL or API Key' });
    }

    try {
        // 1. AUTHENTICATE: Check the database for this specific key
        const { data: user, error: authError } = await supabase
            .from('users')
            .select('*')
            .eq('key', apiKey)
            .single();

        if (authError || !user) {
            return res.status(401).json({ error: 'Invalid API Key' });
        }

        console.log(`🚀 Request from: ${user.email} | Current Usage: ${user.usage}`);

        // 2. SCRAPE: Run the Playwright logic
        const markdownData = await scrapeToMarkdown(targetUrl);

        // 3. SAVE DATA: Store the result in scraped_data
        const { error: saveError } = await supabase
            .from('scraped_data')
            .insert([{ 
                url: targetUrl, 
                content: markdownData.content,
                user_id: user.id // Linking the scrape to the user
            }]);

        if (saveError) throw saveError;

        // 4. METERING: Increment the user's usage count
        await supabase.rpc('increment_usage', { user_key: apiKey });

        res.json({
            success: true,
            user_email: user.email,
            new_usage_total: user.usage + 1,
            data: markdownData
        });

    } catch (err) {
        console.error('❌ Error:', err.message);
        res.status(500).json({ error: 'Internal Server Error', details: err.message });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 SaaS API Live on port ${PORT}`);
});