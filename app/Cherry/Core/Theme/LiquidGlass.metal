#include <metal_stdlib>
#include <SwiftUI/SwiftUI.h>
using namespace metal;

// La sfera di vetro della welcome, in due passate (studio Wabi / Appllama):
//
// - `liquidLens` è un filtro sul fondale: rifrazione da vetro spesso che
//   ingrandisce verso il centro, stira forte sul bordo bevellato, piega i
//   tre canali colore di quantità diverse (dispersione) e trascina la
//   figura dentro con il moto, così il "liquido" resta indietro rispetto
//   al vetro.
// - `liquidGlass` è disegnato sopra: un velo latteo dentro, un alone
//   fuori, un filo di luce sul bordo, uno sheen largo in alto a sinistra
//   e — mentre la sfera viene spinta — il caustico cromatico: un bloom
//   lavanda-ciano che si mette a fuoco in una ciotola di luce (un buco
//   ovale chiaro, una banda ciano→azzurro→blu profondo, un filo d'oro
//   oltre, una traccia ciano lungo il bordo).
//
// Geometria del caustico, in raggi lungo la direzione di moto `dv`:
// ellisse dell'anello centrata a 0.639 con semiassi 0.52 × 0.361; buco
// centrato a 0.750 con raggio 0.245 a fuoco pieno; filo d'oro a ~1.15.

[[ stitchable ]] half4 liquidLens(float2 p, SwiftUI::Layer layer,
                                  float2 c, float r,
                                  float amount, float bezel, float disp,
                                  float2 slosh) {
    float2 d = (p - c) / r;
    float rr = length(d);
    if (rr >= 1.0) { return layer.sample(p); }
    // lente spessa: tutto l'interno ingrandisce, il bevel al bordo tira
    // forte — quel che lo attraversa si stira lungo il bordo
    float bev = smoothstep(1.0 - bezel, 1.0, rr);
    float k = amount * (0.42 + 0.58 * bev * bev);
    // il liquido dentro resta indietro: la figura è trascinata col moto,
    // al massimo al centro e per niente al bordo
    float2 back = (p - c) * k + slosh * (1.0 - rr * rr);
    half4 cr = layer.sample(p - back * (1.0 + disp));
    half4 cg = layer.sample(p - back);
    half4 cb = layer.sample(p - back * (1.0 - disp));
    half aa = max(cg.a, max(cr.a, cb.a));
    return half4(cr.r, cg.g, cb.b, aa);
}

[[ stitchable ]] half4 liquidGlass(float2 p, half4 color,
                                   float2 c, float r,
                                   float glow,      // 0..1, quanto forte viene spinta
                                   float2 dv,       // versore verso il bordo d'attacco
                                   float small,     // 0 = cupola del gate, 1 = pulsante +
                                   float caus) {    // 0..1, quanto caustico mostra questa taglia
    float2 d = (p - c) / r;
    float rr = length(d);
    if (rr > 1.34) { return half4(0.0); }
    float aa = 1.4 / r;
    float inside = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, rr);
    float2 nd = d / max(rr, 1e-4);

    // ── alone fuori dal bordo: un grigio morbido, più pesante sotto ─────────
    float haloW = mix(0.075, 0.20, small);
    float halo = (1.0 - smoothstep(1.0, 1.0 + haloW, rr)) * (1.0 - inside);
    float sh = halo * (0.075 + 0.11 * smoothstep(-0.4, 1.0, d.y)) * mix(1.0, 1.5, small);

    // ── il corpo ───────────────────────────────────────────────────────────
    float dome = 1.0 - smoothstep(0.0, 1.0, rr);
    float a = mix(0.06 + 0.06 * dome, 0.22 + 0.08 * dome, small);
    half3 col = half3(1.0);

    // ── bordo e sheen ──────────────────────────────────────────────────────
    float rim   = smoothstep(0.958, 0.990, rr) * (1.0 - smoothstep(0.990, 1.0, rr));
    float inner = smoothstep(0.90, 0.975, rr) * (1.0 - smoothstep(0.975, 1.0, rr));
    float up    = clamp(dot(nd, normalize(float2(0.30, -0.95))), 0.0, 1.0);
    float sheen = smoothstep(0.86, 0.945, rr) * (1.0 - smoothstep(0.965, 0.995, rr)) * pow(up, 1.3)
                + smoothstep(0.62, 0.90, rr) * (1.0 - smoothstep(0.90, 0.97, rr)) * pow(up, 2.2) * 0.35;
    float lowRim = smoothstep(0.86, 0.975, rr) * (1.0 - smoothstep(0.975, 1.0, rr))
                 * pow(clamp(dot(nd, normalize(float2(0.42, 0.90))), 0.0, 1.0), 2.4);
    a += rim * mix(0.62, 0.80, small) + sheen * mix(0.62, 0.50, small) + lowRim * mix(0.14, 0.40, small);
    col = mix(col, half3(0.70, 0.72, 0.76), half(inner * 0.34));

    // ── caustico di moto ───────────────────────────────────────────────────
    float g = glow * caus;
    if (g > 0.002) {
        a += g * 0.12 * (1.0 - smoothstep(0.80, 1.0, rr));

        float2 ax = dv;
        float2 px = float2(-ax.y, ax.x);
        float u = dot(d, px);
        float v = dot(d, ax);

        float focus = smoothstep(0.10, 0.80, g);
        float holeR = mix(0.06, 0.245, focus);
        float soft  = mix(0.55, 0.0, focus);

        float eo = length(float2(u / 0.52, (v - 0.639) / 0.361));
        float eh = length(float2(u, v - 0.750)) / holeR;

        float band = (1.0 - smoothstep(0.86 - soft, 1.06 + soft * 0.5, eo))
                   * smoothstep(0.80 - soft * 0.6, 1.18 + soft, eh);
        band *= 1.0 - smoothstep(0.955, 1.0, rr);

        half3 cyan = half3(0.36, 0.86, 0.96);
        half3 azur = half3(0.06, 0.53, 0.98);
        half3 deep = half3(0.12, 0.31, 0.91);
        half3 lav  = half3(0.66, 0.68, 0.92);
        half3 ring = mix(cyan, azur, half(smoothstep(0.46, 0.72, eo)));
        ring = mix(ring, deep, half(smoothstep(0.72, 0.86, eo)));
        ring = mix(lav, ring, half(0.35 + 0.65 * focus));

        float grade = 0.28 + 0.72 * smoothstep(0.42, 0.80, eo);
        float ba = band * grade * mix(0.55, 0.92, focus) * g;
        col = mix(col, ring, half(clamp(ba * 1.25, 0.0, 1.0)));
        a += ba;

        // la luce che passa dal buco
        a += (1.0 - smoothstep(0.10, 1.06, eh)) * g * 0.30 * focus * (1.0 - smoothstep(0.94, 1.0, rr));

        // dispersione: un filo d'oro pallido appena fuori dal blu, quasi
        // tutto sul lato di coda — un filo, non un anello
        float trail = 0.35 + 0.65 * smoothstep(0.2, 0.9, -v);
        float gold = smoothstep(1.115, 1.145, eo) * (1.0 - smoothstep(1.155, 1.19, eo))
                   * (1.0 - smoothstep(0.965, 1.0, rr)) * g * focus * trail;
        col = mix(col, half3(1.0, 0.85, 0.42), half(clamp(gold * 1.4, 0.0, 1.0)));
        a += gold * 0.32;

        // e la traccia ciano lungo il bordo, dove l'anello lo incontra
        float lobe = 0.45 + 0.55 * (1.0 - smoothstep(0.55, 1.25, eo));
        float trace = rim * lobe * g;
        col = mix(col, half3(0.30, 0.86, 1.0), half(clamp(trace * 1.7, 0.0, 1.0)));
        a += trace * 0.35;
    }

    // ── il bordo del pulsante prende colore da quel che gli passa accanto ──
    if (small > 0.01) {
        float ang = atan2(d.y, d.x);
        float edge = smoothstep(0.955, 0.985, rr) * (1.0 - smoothstep(0.985, 1.0, rr));
        half3 iris = half3(0.5 + 0.5 * cos(6.2832 * (ang * 0.55 + 0.00)),
                           0.5 + 0.5 * cos(6.2832 * (ang * 0.55 + 0.33)),
                           0.5 + 0.5 * cos(6.2832 * (ang * 0.55 + 0.67)));
        col = mix(col, iris, half(clamp(edge * 0.28 * small, 0.0, 1.0)));
        float line = smoothstep(0.985, 0.995, rr) * (1.0 - smoothstep(0.995, 1.0, rr));
        col = mix(col, half3(0.55, 0.56, 0.60), half(line * 0.55 * small));
        a += line * 0.30 * small;
    }

    a = clamp(a, 0.0, 1.0) * inside + sh;
    half3 outc = mix(half3(0.0), col, half(inside));
    return half4(outc * half(a), half(a));
}
