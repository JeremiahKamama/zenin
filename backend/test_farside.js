const { fetchFarsideEtfFlows } = require("./farsideEtf");

async function test() {
  try {
    const fetch = (await import("node-fetch")).default;
    console.log("Fetching Farside flows...");
    const flows = await fetchFarsideEtfFlows(fetch);
    console.log("Flows count:", flows ? flows.length : 0);
    if (flows && flows.length > 0) {
      console.log("Sample flow:", JSON.stringify(flows[0], null, 2));
    } else {
      console.log("No flows found.");
    }
  } catch (err) {
    console.error("Test failed:", err);
  }
}

test();
