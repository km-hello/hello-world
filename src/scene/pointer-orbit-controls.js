import { EventDispatcher, Spherical } from "three";

export class PointerOrbitControls extends EventDispatcher {
    constructor(camera, canvas) {
        super();
        this.camera = camera;
        this.canvas = canvas;
        this.spherical = new Spherical();
        this.pointerId = null;
        this._enabled = false;
        this._rotated = false;
        this._onPointerDown = this._onPointerDown.bind(this);
        this._onPointerMove = this._onPointerMove.bind(this);
        this._onPointerEnd = this._onPointerEnd.bind(this);
        canvas.addEventListener("pointerdown", this._onPointerDown);
        canvas.addEventListener("pointermove", this._onPointerMove);
        for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
            canvas.addEventListener(type, this._onPointerEnd);
        }
    }

    get enabled() {
        return this._enabled;
    }

    set enabled(value) {
        this._enabled = value;
        if (!value) this._endDrag();
        this.canvas.style.cursor = value ? "grab" : "auto";
    }

    get rotated() {
        return this._rotated;
    }

    set rotated(value) {
        if (value === this._rotated) return;
        this._rotated = value;
        this._endDrag();
    }

    _onPointerDown(event) {
        if (!this.enabled || !event.isPrimary || event.button !== 0 || this.pointerId !== null) return;
        this.canvas.setPointerCapture(event.pointerId);
        this.pointerId = event.pointerId;
        this.x = event.clientX;
        this.y = event.clientY;
        this.canvas.style.cursor = "grabbing";
        this.dispatchEvent({ type: "start" });
    }

    _onPointerMove(event) {
        if (event.pointerId !== this.pointerId) return;
        const scale = 2 * Math.PI / Math.max(1, this.canvas.clientHeight);
        const dx = event.clientX - this.x;
        const dy = event.clientY - this.y;
        this.spherical.setFromVector3(this.camera.position);
        this.spherical.theta -= (this.rotated ? dy : dx) * scale;
        this.spherical.phi -= (this.rotated ? -dx : dy) * scale;
        this.spherical.makeSafe();
        this.camera.position.setFromSpherical(this.spherical);
        this.camera.lookAt(0, 0, 0);
        this.x = event.clientX;
        this.y = event.clientY;
        this.dispatchEvent({ type: "change" });
    }

    _onPointerEnd(event) {
        if (event.pointerId === this.pointerId) this._endDrag();
    }

    _endDrag() {
        const pointerId = this.pointerId;
        this.pointerId = null;
        if (pointerId !== null && this.canvas.hasPointerCapture(pointerId)) {
            this.canvas.releasePointerCapture(pointerId);
        }
        this.canvas.style.cursor = this.enabled ? "grab" : "auto";
    }

    dispose() {
        this.enabled = false;
        this.canvas.removeEventListener("pointerdown", this._onPointerDown);
        this.canvas.removeEventListener("pointermove", this._onPointerMove);
        for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
            this.canvas.removeEventListener(type, this._onPointerEnd);
        }
    }
}
