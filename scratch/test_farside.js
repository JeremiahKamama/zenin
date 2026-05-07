async function testFetch() {
  const url = 'https://farside.co.uk/bitcoin-etf-flow/';
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
  });
  const html = await response.text();
  console.log(html.slice(0, 5000));
}

testFetch();
