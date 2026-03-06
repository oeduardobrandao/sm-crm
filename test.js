async function run() {
  const res = await fetch('https://skjzpekeqefvlojenfsw.supabase.co/functions/v1/instagram-integration/summary/21', {
    headers: { Authorization: "Bearer undefined" }
  });
  console.log("Status:", res.status);
  console.log("Body:", await res.text());
}
run();
