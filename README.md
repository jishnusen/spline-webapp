# Quintic Hermite Spline Plotter for FRC

GUI app to plot quintic hermite splines on provided field (under `assets`) using an HTML5 canvas.

Spline coordinates generated private C++ spline generation. (see [here](https://github.com/jishnusen/robot-code-public/blob/master/muan/control/spline.cpp))
for archived code.

C++ code is compiled to WASM for client-side spline generation. Coordinates are processed as "poses". Logic found at `resources/js/script.js`.
