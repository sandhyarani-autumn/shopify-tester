import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

serve(async (req) => {
  try {
    const payload = await req.json()
    console.log("Webhook received payload:", payload)

    const record = payload.record
    
    // Only proceed if it is an INSTANT test trigger
    if (!record || record.run_time !== 'instant') {
      return new Response(JSON.stringify({ msg: "Not an instant test, ignoring." }), {
        headers: { "Content-Type": "application/json" },
        status: 200 
      })
    }

    const { store_url, product, slack_webhook, client_name } = record;
    const GITHUB_PAT = Deno.env.get("GITHUB_PAT")

    if (!GITHUB_PAT) {
      console.error("Missing GITHUB_PAT environment variable");
      return new Response("Server error: Missing GitHub PAT", { status: 500 })
    }

    const githubUrl = "https://api.github.com/repos/sandhyarani-autumn/shopify-tester/actions/workflows/instant-test.yml/dispatches";
    
    console.log(`Triggering GitHub Action at: ${githubUrl}`);

    const response = await fetch(githubUrl, {
      method: "POST",
      headers: {
        "Accept": "application/vnd.github.v3+json",
        "Authorization": `Bearer ${GITHUB_PAT}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ref: "main",
        inputs: {
          store_url: store_url || "",
          product: product || "",
          slack_webhook: slack_webhook || "",
          client_name: client_name || "Instant Client"
        }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("GitHub API Error:", response.status, errText);
      return new Response(`Failed to trigger GitHub Actions: ${errText}`, { status: 500 });
    }

    return new Response(JSON.stringify({ success: true, message: "Triggered successfully" }), {
      headers: { "Content-Type": "application/json" },
      status: 200
    });

  } catch (err) {
    console.error("Function error:", err.message);
    return new Response(`Error: ${err.message}`, { status: 400 });
  }
})
