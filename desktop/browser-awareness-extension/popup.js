"use strict";
const statusNode = document.getElementById("status");
const field = (id) => document.getElementById(id);
async function message(value) {
  const response = await chrome.runtime.sendMessage(value);
  if (!response?.ok) throw new Error("Not available or not permitted. Check the app and this profile's grants.");
  return response.result;
}
function show(value) {
  statusNode.textContent = value.paired ? "Profile paired. Collection still requires the app's current grant." : "Not paired.";
  field("origin").value = value.origins[0] || "";
  for (const id of ["visits", "bookmarks", "excerpts"]) field(id).checked = value[id];
}
async function run(work) {
  try { await work(); } catch (error) { statusNode.textContent = error.message; }
}
field("pair-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void run(async () => { show(await message({kind: "pair", code: field("code").value.trim()})); field("code").value = ""; });
});
field("settings-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void run(async () => {
    const url = new URL(field("origin").value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("Choose an HTTP(S) origin without credentials.");
    const permissions = [];
    if (field("visits").checked) permissions.push("history");
    if (field("bookmarks").checked) permissions.push("bookmarks");
    const origins = field("visits").checked ? [`${url.origin}/*`] : [];
    if ((permissions.length || origins.length) && !await chrome.permissions.request({permissions, origins})) throw new Error("Chrome permission was not granted.");
    show(await message({kind: "configure", config: {origins: [url.origin], visits: field("visits").checked, bookmarks: field("bookmarks").checked, excerpts: field("excerpts").checked}}));
    statusNode.textContent = "Saved for this profile. The app independently decides what may be admitted.";
  });
});
for (const kind of ["bookmark", "excerpt"]) field(`share-${kind}`).addEventListener("click", () => {
  void run(async () => { const result = await message({kind: `share_${kind}`}); statusNode.textContent = result.admitted ? "Reference admitted by the app." : "No new reference was admitted."; });
});
void run(async () => show(await message({kind: "status"})));
