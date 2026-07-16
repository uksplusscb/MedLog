import fs from 'fs';

const config = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf-8'));
const projectId = config.projectId;

async function run() {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;
    const payload = {
      structuredQuery: {
        from: [{ collectionId: 'visits' }],
        limit: 10
      }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json() as any;
    console.log("=== FIRESTORE REST QUERY RESULTS ===");
    if (Array.isArray(data)) {
      console.log(`Found ${data.length} visits (up to 10):`);
      data.forEach((item: any, idx: number) => {
        if (item.document) {
          const fields = item.document.fields;
          console.log(`[${idx}] date: ${fields?.date?.stringValue}, studentName: ${fields?.studentName?.stringValue}`);
        } else {
          console.log(`[${idx}] No document data:`, JSON.stringify(item));
        }
      });
    } else {
      console.log("Unexpected response format:", JSON.stringify(data));
    }

    // Now query summaries
    const payloadSummary = {
      structuredQuery: {
        from: [{ collectionId: 'summary' }]
      }
    };
    const resSummary = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payloadSummary)
    });
    const dataSummary = await resSummary.json() as any;
    console.log("\n=== FIRESTORE REST SUMMARIES ===");
    if (Array.isArray(dataSummary)) {
      dataSummary.forEach((item: any, idx: number) => {
        if (item.document) {
          const name = item.document.name;
          const fields = item.document.fields;
          console.log(`Doc Name: ${name}`);
          console.log(`Fields:`, JSON.stringify(fields));
        }
      });
    } else {
      console.log("No summaries found or unexpected format:", JSON.stringify(dataSummary));
    }
  } catch (err) {
    console.error("Error with REST API query:", err);
  }
}

run();
