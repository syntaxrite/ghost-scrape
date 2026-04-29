const supabase = require("../../lib/supabase");

module.exports = async (req, res) => {
  // =============================
  // CORS
  // =============================
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    // =============================
    // Parse body safely
    // =============================
    let body = {};

    if (typeof req.body === "object") {
      body = req.body;
    } else if (typeof req.body === "string") {
      try {
        body = JSON.parse(req.body);
      } catch {}
    }

    const email = body.email;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Email required"
      });
    }

    // =============================
    // Send OTP (Supabase)
    // =============================
    const { error } = await supabase.auth.signInWithOtp({
      email
    });

    if (error) {
      console.error("OTP ERROR:", error);

      return res.status(500).json({
        success: false,
        error: error.message
      });
    }

    // =============================
    // SUCCESS
    // =============================
    return res.status(200).json({
      success: true,
      message: "OTP sent"
    });

  } catch (err) {
    console.error("REQUEST OTP ERROR:", err);

    return res.status(500).json({
      success: false,
      error: err.message || "Server error"
    });
  }
}; 