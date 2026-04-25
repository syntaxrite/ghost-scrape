require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 10000; // Use Render's port or default to 10000

// Initialize Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

app.use(express.json());

// Middleware to check API Key
async function checkApiKey(req, res, next) {
    const apiKey = req.header('x-api-key');

    const { data: user, error } = await supabase
        .from('users')
        .select('*')
        .eq('key', apiKey)
        .single();

    if (error) {
        // THIS WILL TELL US THE REAL PROBLEM IN THE TERMINAL
        console.log("❌ DATABASE ERROR:", error.message);
        return res.status(401).json({ error: error.message }); 
    }

    if (!user) {
        console.log("❌ KEY NOT FOUND IN DB");
        return res.status(401).json({ error: 'API Key not found' });
    }

    req.user = user;
    next();
}

// THE SCRAPE ROUTE
app.get('/scrape', checkApiKey, async (req, res) => {
    const targetUrl = req.query.url;
    
    if (!targetUrl) {
        return res.status(400).json({ error: 'Please provide a ?url= parameter' });
    }

    console.log(`✅ Verified user: ${req.user.email} is scraping: ${targetUrl}`);

    try {
        // This is where we will add Playwright + Turndown next!
        // res.json({ 
        //     status: "Authenticated",
        //     message: "Your API key is working!",
        //     target: targetUrl,
        //     user_email: req.user.email
        // });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 10000; // Use Render's port or default to 10000

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running at http://0.0.0.0:${PORT}`);
    console.log(`🔌 Connected to Supabase`);
});