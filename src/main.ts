import "./style.css";
const view = new URLSearchParams(location.search).get("view");
if (view === "motion") {
  await import("./motion-preview");
} else if (view === "avatar") {
  await import("./avatar");
} else {
  await import("./panel");
}
