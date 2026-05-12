const { fetchFarsideEtfFlows } = require("../backend/farsideEtf");

async function debug() {
    console.log("Starting Farside debug...");
    try {
        // Use global fetch (Node 18+)
        const flows = await fetchFarsideEtfFlows(fetch);
        console.log(`Fetched ${flows.length} flow items.`);
        if (flows.length > 0) {
            console.log("First item:", flows[0]);
        } else {
            console.log("No flows returned. The scraper might be broken by site layout changes.");
        }
    } catch (error) {
        console.error("Debug failed:", error);
    }
}

debug();
