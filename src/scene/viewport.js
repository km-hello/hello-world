const WORLD_VERTICAL_SPAN = 4;
const MIN_HORIZONTAL_POSITION_SPAN = 3.4;
const MIN_HORIZONTAL_GLOW_SPAN = 2;

function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}

function smoothstep(value) {
    const normalized = clamp(value, 0, 1);
    return normalized * normalized * (3 - 2 * normalized);
}

export function getPositionScale(width, height) {
    return Math.min(
        height / WORLD_VERTICAL_SPAN,
        width / MIN_HORIZONTAL_POSITION_SPAN,
    );
}

export function getGlowScale(width, height) {
    return Math.min(
        height / WORLD_VERTICAL_SPAN,
        width / MIN_HORIZONTAL_GLOW_SPAN,
    );
}

/**
 * Return the perspective multiplier while a body is in front of the viewer.
 * At and beyond the camera plane the renderer clips the body naturally.
 */
export function getVisualPerspective(forwardDistance, cameraDistance) {
    return forwardDistance > 0
        ? cameraDistance / forwardDistance
        : Number.POSITIVE_INFINITY;
}

/**
 * Fade a billboard before its center reaches the camera's near clipping plane.
 * Perspective remains uncapped; only opacity changes during the final approach.
 */
export function getNearCameraFade(
    forwardDistance,
    nearDistance,
    fullOpacityDistance,
) {
    return smoothstep(
        (forwardDistance - nearDistance)
        / (fullOpacityDistance - nearDistance),
    );
}
