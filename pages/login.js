import { useState } from "react";
import Layout from "../components/Layout";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleLogin = async () => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (data.success) {
      localStorage.setItem("apiKey", data.apiKey);
      window.location.href = "/dashboard";
    }
  };

  return (
    <Layout title="Login">
      <div className="max-w-sm mx-auto space-y-4">
        <input className="w-full border p-2" type="email" placeholder="Email" onChange={e => setEmail(e.target.value)} />
        <input className="w-full border p-2" type="password" placeholder="Password" onChange={e => setPassword(e.target.value)} />
        <button className="w-full bg-blue-600 text-white p-2" onClick={handleLogin}>Login</button>
      </div>
    </Layout>
  );
}
