const WORLD_VERTICAL_SPAN = 4;
const MIN_HORIZONTAL_POSITION_SPAN = 3.4;
const MIN_HORIZONTAL_GLOW_SPAN = 2;
const RECOVERY_URGENCY_DELAY = 6;
const RECOVERY_URGENCY_RAMP = 2;
const RECOVERY_PROGRESS_EPSILON = 0.01;
const MIN_RECOVERY_PERSPECTIVE = 0.65;
const MAX_RECOVERY_PERSPECTIVE = 1.62;
const MIN_GLOW_RADIUS = 32;
const MAX_RECOVERY_GLOW_RADIUS = 220;

export const MAX_RECOVERY_STALL_DURATION = 12;

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

export function getOffscreenOverflow(
    projectedX,
    projectedY,
    coreRadius,
    width,
    height,
    margin,
) {
    return Math.max(
        0,
        -margin - (projectedX + coreRadius),
        projectedX - coreRadius - (width + margin),
        -margin - (projectedY + coreRadius),
        projectedY - coreRadius - (height + margin),
    );
}

export function getRecoveryOverflow(
    positionX,
    positionY,
    positionZ,
    width,
    height,
    positionScale,
    glowScale,
    cameraDistance,
    positionWorldScale,
) {
    const visualDepth = positionZ * positionWorldScale;
    const safeDepth = Math.min(visualDepth, cameraDistance - 0.5);
    const perspective = clamp(
        cameraDistance / (cameraDistance - safeDepth),
        MIN_RECOVERY_PERSPECTIVE,
        MAX_RECOVERY_PERSPECTIVE,
    );
    const depthIntensity = smoothstep(
        (perspective - MIN_RECOVERY_PERSPECTIVE)
        / (MAX_RECOVERY_PERSPECTIVE - MIN_RECOVERY_PERSPECTIVE),
    );
    const projectedX = width / 2 + positionX * positionScale * perspective;
    const projectedY = height / 2 - positionY * positionScale * perspective;
    const recoveryRadius = clamp(
        glowScale * 0.54 * perspective * (0.86 + 0.3 * depthIntensity),
        MIN_GLOW_RADIUS,
        MAX_RECOVERY_GLOW_RADIUS,
    );

    return getOffscreenOverflow(
        projectedX,
        projectedY,
        recoveryRadius * 0.16,
        width,
        height,
        Math.min(width, height) * 0.15,
    );
}

/**
 * Update fixed-capacity viewport recovery state without allocating per frame.
 * The stall timer grows only while a body is not making visible return progress.
 */
export function updateRecoveryTracking(
    offscreenDurations,
    stallDurations,
    previousOverflows,
    body,
    overflow,
    deltaTime,
) {
    const safeDelta = Math.max(0, deltaTime);
    const previousOverflow = previousOverflows[body];

    if (overflow > 0) {
        offscreenDurations[body] += safeDelta;

        const isReturning =
            previousOverflow > 0
            && overflow < previousOverflow - RECOVERY_PROGRESS_EPSILON;

        if (isReturning) {
            stallDurations[body] = Math.max(
                0,
                stallDurations[body] - safeDelta * 2,
            );
        } else {
            stallDurations[body] += safeDelta;
        }
    } else {
        offscreenDurations[body] = Math.max(
            0,
            offscreenDurations[body] - safeDelta * 4,
        );
        stallDurations[body] = 0;
    }

    previousOverflows[body] = overflow;

    return smoothstep(
        (offscreenDurations[body] - RECOVERY_URGENCY_DELAY)
        / RECOVERY_URGENCY_RAMP,
    );
}
