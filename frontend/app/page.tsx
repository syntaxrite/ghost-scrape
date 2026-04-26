"use client";

import React, { useState } from "react";

export default function LandingPage() {
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const handleScrape = async () => {
    if (!url) return;
    setLoading(true);
    
    try {
      // Connects to your Node.js backend
      const response = await fetch(`http://localhost:5000/scrape?url=${encodeURIComponent(url)}`);
      const data = await response.json();
      
      if (response.ok) {
        setResult(data);
      } else {
        alert(data.error || "Error occurred");
      }
    } catch (err) {
      alert("Could not connect to server. Is node server.js running?");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: "800px", margin: "0 auto" }}>
      <h1>Smart Markdown Distiller</h1>
      
      <div style={{ marginBottom: "20px" }}>
        <input 
          type="text" 
          placeholder="Paste URL (Medium, Wikipedia, etc.)"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          style={{ width: "80%", padding: "10px", color: "#000" }}
        />
        <button 
          onClick={handleScrape}
          disabled={loading}
          style={{ padding: "10px 20px", marginLeft: "10px", cursor: "pointer" }}
        >
          {loading ? "Distilling..." : "Scrape"}
        </button>
      </div>

      {result && (
        <div style={{ border: "1px solid #444", padding: "20px", background: "#222" }}>
          <h2>{result.title}</h2>
          <p><strong>Method:</strong> {result.method}</p>
          <p><strong>Stats:</strong> {result.stats?.savings}</p>
          <hr style={{ borderColor: "#444" }} />
          <pre style={{ whiteSpace: "pre-wrap", color: "#0f0" }}>
            {result.markdown?.content}
          </pre>
        </div>
      )}
    </div>
  );
}