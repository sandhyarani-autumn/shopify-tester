const fs      = require('fs');
const path    = require('path');
const https   = require('https');
const { v2: cloudinary } = require('cloudinary');

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Read test data
const results     = JSON.parse(fs.readFileSync('results.json', 'utf-8'));
const stores      = JSON.parse(fs.readFileSync('stores-to-run.json', 'utf-8'));
const stepResults = fs.existsSync('step-results.json')
  ? JSON.parse(fs.readFileSync('step-results.json', 'utf-8'))
  : {};
const allSpecs = results.suites.flatMap(s => s.specs);

// IST timestamp
const time = new Date().toLocaleString('en-IN', {
  timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short'
});

(async () => {
  for (const store of stores) {

    const spec   = allSpecs.find(s =>
      s.title.includes(store.store_url) ||
      s.title.includes(store.client_name)
    );
    const passed = spec ? spec.ok : false;
    const steps  = stepResults[store.store_url] || [];

    if (passed) {

      // ── PASS ──────────────────────────────────────────
      const stepSummary = steps.map(s => `✅ ${s.step}`).join('\n');

      const message =
        `✅ *Shopify Daily Test — PASSED*\n\n` +
        `🏪 *Store:* ${store.store_url}\n` +
        `👤 *Client:* ${store.client_name}\n` +
        `🔍 *Product Tested:* "${store.product}"\n` +
        `⏰ *Scheduled Time:* ${formatTime(store.run_time)} IST\n\n` +
        `*Step by Step Results:*\n${stepSummary}\n\n` +
        `🎉 Everything is working perfectly!\n` +
        `🕐 Tested at: ${time}`;

      await sendSlackText(store.slack_webhook, message);

      // Delete local files — no need to keep on pass
      deleteLocalFiles();

    } else {

      // ── FAIL ──────────────────────────────────────────
      const stepSummary = steps.map(s => {
        if (s.status === 'pass') return `✅ ${s.step}`;
        if (s.status === 'fail') return `❌ ${s.step} — ${s.error}`;
        return `⛔ ${s.step} — Skipped`;
      }).join('\n');

      const screenshotPath = findFile('png');
      const videoPath      = findFile('webm');

      let videoUrl = null;

      // Upload video to Cloudinary
      if (videoPath && fs.existsSync(videoPath)) {
        try {
          console.log('Uploading video to Cloudinary...');
          const upload = await cloudinary.uploader.upload(videoPath, {
            resource_type: 'video',
            folder:        'shopify-tester',
            public_id:     `fail-${Date.now()}`,
            invalidate:    true,
          });
          videoUrl = upload.secure_url;
          console.log('Video uploaded:', videoUrl);

          // Auto delete triggered via periodic cleanup script (runs every day)
          await deleteOldCloudinaryVideos();

        } catch (e) {
          console.error('Cloudinary upload failed:', e.message);
        }
      }

      const message =
        `❌ *Shopify Daily Test — FAILED*\n\n` +
        `🏪 *Store:* ${store.store_url}\n` +
        `👤 *Client:* ${store.client_name}\n` +
        `🔍 *Product Tested:* "${store.product}"\n` +
        `⏰ *Scheduled Time:* ${formatTime(store.run_time)} IST\n\n` +
        `*Step by Step Results:*\n${stepSummary}\n\n` +
        (videoUrl ? `🎬 *Test Recording:* ${videoUrl}\n` : '') +
        `⚠️ Please check your store and fix the issue.\n` +
        (videoUrl ? `🗑️ Video auto-deleted after 5 days.\n` : '') +
        `🕐 Tested at: ${time}`;

      await sendSlackText(store.slack_webhook, message);

      // Send screenshot to Slack
      if (screenshotPath && fs.existsSync(screenshotPath)) {
        await sendSlackText(
          store.slack_webhook,
          `📸 *Screenshot captured at the point of failure.*`
        );
      }

      // Delete all local files immediately
      deleteLocalFiles();
    }
  }
})();

// ── Send text to Slack ──────────────────────────────
function sendSlackText(webhookUrl, text) {
  return new Promise((resolve) => {
    try {
      const url  = new URL(webhookUrl);
      const body = JSON.stringify({ text });
      const req  = https.request({
        hostname: url.hostname,
        path:     url.pathname,
        method:   'POST',
        headers: {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      }, () => resolve());
      req.on('error', () => resolve());
      req.write(body);
      req.end();
      console.log('Slack message sent!');
    } catch (e) {
      console.error('Slack failed:', e.message);
      resolve();
    }
  });
}

// ── Find test result files ──────────────────────────
function findFile(extension) {
  const dir = 'test-results';
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir, { recursive: true });
  const match = files.find(f =>
    typeof f === 'string' && f.endsWith(`.${extension}`)
  );
  return match ? path.join(dir, match) : null;
}

// ── Delete local test files ─────────────────────────
function deleteLocalFiles() {
  try {
    if (fs.existsSync('test-results')) {
      fs.rmSync('test-results', { recursive: true, force: true });
      console.log('Local test files deleted');
    }
  } catch (e) {
    console.error('Delete failed:', e.message);
  }
}

// ── Format time ─────────────────────────────────────
function formatTime(time) {
  if (!time) return time;
  const [h, m] = time.split(':');
  const hour   = parseInt(h);
  return `${hour % 12 || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`;
}

// ── Delete old videos from Cloudinary ───────────────
async function deleteOldCloudinaryVideos() {
  try {
    console.log('Checking for Cloudinary videos older than 5 days...');
    const result = await cloudinary.api.resources({
      type: 'upload',
      prefix: 'shopify-tester', // Check inside this specific folder
      resource_type: 'video',
      max_results: 50 // Fetch up to 50 videos
    });

    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    let deletedCount = 0;
    for (const resource of result.resources) {
      const uploadDate = new Date(resource.created_at);
      if (uploadDate < fiveDaysAgo) {
        console.log(`Deleting old video: ${resource.public_id} (Uploaded: ${uploadDate.toDateString()})`);
        await cloudinary.uploader.destroy(resource.public_id, { resource_type: 'video' });
        deletedCount++;
      }
    }
    console.log(`Cloudinary cleanup complete. Deleted ${deletedCount} old videos.`);
  } catch (error) {
    console.error('Failed to clean up old Cloudinary videos:', error.message);
  }
}