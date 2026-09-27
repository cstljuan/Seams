import { cancelRender, continueRender, delayRender, staticFile } from "remotion";

// Afacad (SIL OFL 1.1), pinned locally in public/fonts.
const handle = delayRender("Loading Afacad");
const face = new FontFace("Afacad", `url(${staticFile("fonts/Afacad-wght.ttf")}) format("truetype")`, {
  weight: "400 700",
});
face
  .load()
  .then((f) => {
    document.fonts.add(f);
    continueRender(handle);
  })
  .catch((err) => {
    cancelRender(err);
  });
