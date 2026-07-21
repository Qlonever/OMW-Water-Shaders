#version 120

uniform sampler2D imageIn;

#include "lib/water/ripples.glsl"

void main()
{
    vec2 uv = gl_FragCoord.xy / @rippleMapSize;

    float pixelSize = 1.0 / @rippleMapSize;

    float oneOffset = pixelSize;

    vec4 n = vec4(
        texture2D(imageIn, uv + vec2(oneOffset, 0.0)).r,
        texture2D(imageIn, uv + vec2(-oneOffset, 0.0)).r,
        texture2D(imageIn, uv + vec2(0.0, oneOffset)).r,
        texture2D(imageIn, uv + vec2(0.0, -oneOffset)).r
    );

    vec4 color = texture2D(imageIn, uv);

    gl_FragColor = applySprings(color, n);
}
