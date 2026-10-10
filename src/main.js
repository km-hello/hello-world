import { ThreeBodyScene } from "./scene/three-body-scene.js";

const canvas = document.querySelector("[data-three-body]");

if (canvas) {
    let monument;
    try {
        monument = new ThreeBodyScene(canvas);
        await monument.start();
    } catch (error) {
        console.error("Unable to start the particle scene.", error);
        monument?.destroy();
        document.body.classList.remove("scene-ready");
        document.body.classList.add("scene-failed");
        canvas.dataset.simulationState = "failed";
    }
}
