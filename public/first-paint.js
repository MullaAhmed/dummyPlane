// Runs before the first paint (index.html, same origin: the CSP allows it): the saved palette,
// mirrored in localStorage by src/app/theme.ts, so the first image already has the right tokens
// before the app's JavaScript loads. No system color query: the default palette is expressive.
(function () {
  var root = document.documentElement;
  var schemes = { calm: "light", electric: "dark", expressive: "dark" };
  var choice = null;
  var transparency = null;
  try {
    choice = localStorage.getItem("ov.theme");
    transparency = localStorage.getItem("ov.transparency");
  } catch (e) {
    // No storage: the default palette, transparency on.
  }
  var palette = Object.prototype.hasOwnProperty.call(schemes, choice) ? choice : "expressive";
  root.dataset.palette = palette;
  root.dataset.theme = schemes[palette];
  root.style.colorScheme = schemes[palette];
  if (transparency === "off") root.dataset.transparency = "off";
})();
