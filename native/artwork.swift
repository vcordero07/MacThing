// artwork <in-image> <max-size> <cover.jpg> <wide.jpg> [background.jpg]
// Prepares a cover for the device in one pass, and prints {"width":…,"height":…} of cover.jpg,
// plus "wideWidth" and "wideHeight" of wide.jpg.
//
// cover.jpg: a square JPEG of at most <max-size>px (the art panel is exactly 480×480), whatever the
// source format was (HEIC/TIFF would not render on the device's 2018-era Chromium). The centre
// crop happens at the source's own resolution, before any resize: a 16:9 video thumbnail scaled to
// fit 480 first is only 270px tall, and filling the square from that stretches it by 1.8×.
//
// wide.jpg: the same cover with its aspect kept, long edge at most <max-size>. Now Playing's 16:9
// setting shows this inside the square; the square crop stays for the default fill and the blur.
//
// background.jpg: the album art background the device shows behind the UI — the cover filling the
// screen's width with mirrored copies against its left and right edges, blurred and saturated to
// match the CSS it replaces (blur(50px) saturate(1.6) on an 800px square, cropped to 800×480), at
// half size. The device scales it back up, which a blur this heavy doesn't show, and no longer has
// to blur anything itself: in software that took it about 1.7s of drawing per cover.
//
// With a background, the JSON also has "tint": {"dark":…,"light":…}, the least black (dark theme)
// or white (light theme) overlay that gives the text over the background 4.5:1 contrast on 90% of
// it. The device uses its usual tint unless this asks for more, so white and yellow covers get
// darker in the dark theme and black ones lighter in the light theme, and the rest stay as they were.

import CoreImage
import Foundation

let args = CommandLine.arguments
guard args.count > 4, let maxSide = Double(args[2]),
  let input = CIImage(contentsOf: URL(fileURLWithPath: args[1]), options: [.applyOrientationProperty: true])
else {
  FileHandle.standardError.write("usage: artwork <in-image> <max-size> <cover.jpg> <wide.jpg> [background.jpg]\n".data(using: .utf8)!)
  exit(2)
}

let srgb = CGColorSpace(name: CGColorSpace.sRGB)!
func writeJPEG(_ image: CIImage, _ path: String, quality: Double, context: CIContext) throws {
  try context.writeJPEGRepresentation(
    of: image, to: URL(fileURLWithPath: path), colorSpace: srgb,
    options: [CIImageRepresentationOption(rawValue: kCGImageDestinationLossyCompressionQuality as String): quality])
}
/// Moves an image's extent to start at the origin.
func atOrigin(_ image: CIImage) -> CIImage {
  image.transformed(by: CGAffineTransform(translationX: -image.extent.minX, y: -image.extent.minY))
}

// ---- Cover ----
let e = input.extent.integral
let sourceSide = min(e.width, e.height)
let square = atOrigin(input.cropped(to: CGRect(
  x: e.minX + ((e.width - sourceSide) / 2).rounded(.down), y: e.minY + ((e.height - sourceSide) / 2).rounded(.down),
  width: sourceSide, height: sourceSide)))
let side = min(sourceSide, CGFloat(maxSide)).rounded()
let cover = side < sourceSide
  ? square.applyingFilter("CILanczosScaleTransform", parameters: [kCIInputScaleKey: side / sourceSide, kCIInputAspectRatioKey: 1])
      .cropped(to: CGRect(x: 0, y: 0, width: side, height: side))
  : square

let coverContext = CIContext(options: [.outputColorSpace: srgb])
do {
  try writeJPEG(cover, args[3], quality: 0.88, context: coverContext)
} catch {
  FileHandle.standardError.write("artwork: \(error.localizedDescription)\n".data(using: .utf8)!)
  exit(1)
}

// The whole frame, long edge at most max-size. A square source comes out square too.
let longSide = max(e.width, e.height)
let wideScale = min(1, CGFloat(maxSide) / longSide)
let wideW = max(1, (e.width * wideScale).rounded())
let wideH = max(1, (e.height * wideScale).rounded())
let fitted = wideScale < 1
  ? atOrigin(input).applyingFilter("CILanczosScaleTransform", parameters: [kCIInputScaleKey: wideScale, kCIInputAspectRatioKey: 1])
  : atOrigin(input)
let wide = fitted.cropped(to: CGRect(x: 0, y: 0, width: wideW, height: wideH))
var wideWidth = 0, wideHeight = 0
do {
  try writeJPEG(wide, args[4], quality: 0.88, context: coverContext)
  wideWidth = Int(wideW)
  wideHeight = Int(wideH)
} catch {
  FileHandle.standardError.write("artwork: wide: \(error.localizedDescription)\n".data(using: .utf8)!)
}

// ---- Background ----
/// WCAG relative luminance of an sRGB colour (components 0…1).
func luminance(_ r: Double, _ g: Double, _ b: Double) -> Double {
  func linear(_ c: Double) -> Double { c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4) }
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}
func contrast(_ a: Double, _ b: Double) -> Double { (max(a, b) + 0.05) / (min(a, b) + 0.05) }

/// {"dark":…,"light":…}: for each theme, the least opacity of its overlay (black under white text,
/// white under #111 text) that brings the text to 4.5:1 on all but the worst 10% of the background.
/// The browser blends the overlay with the sRGB values as they are, so that's what is modelled.
func backgroundTint(_ image: CIImage, context: CIContext) -> String {
  let w = Int(image.extent.width), h = Int(image.extent.height)
  var rgba = [UInt8](repeating: 0, count: w * h * 4)
  context.render(image, toBitmap: &rgba, rowBytes: w * 4, bounds: image.extent, format: .RGBA8, colorSpace: srgb)
  // Every 4th pixel each way is plenty for an image this blurred.
  var pixels: [(Double, Double, Double)] = []
  for y in stride(from: 0, to: h, by: 4) {
    for x in stride(from: 0, to: w, by: 4) {
      let i = (y * w + x) * 4
      pixels.append((Double(rgba[i]) / 255, Double(rgba[i + 1]) / 255, Double(rgba[i + 2]) / 255))
    }
  }
  func needed(overlay: Double, text: Double) -> Double {
    let needs = pixels.map { p -> Double in
      let meets = { (a: Double) -> Bool in
        let mix = { (c: Double) in c * (1 - a) + overlay * a }
        return contrast(luminance(mix(p.0), mix(p.1), mix(p.2)), text) >= 4.5
      }
      if meets(0) { return 0 }
      var lo = 0.0, hi = 1.0
      for _ in 0..<12 { let mid = (lo + hi) / 2; if meets(mid) { hi = mid } else { lo = mid } }
      return hi
    }.sorted()
    return needs.isEmpty ? 0 : needs[needs.count * 9 / 10]
  }
  let dark = needed(overlay: 0, text: 1)
  let light = needed(overlay: 1, text: luminance(17 / 255, 17 / 255, 17 / 255))
  return String(format: "{\"dark\":%.2f,\"light\":%.2f}", dark, light)
}

var tint: String? = nil
if args.count > 5 {
  let scale: CGFloat = 0.5 // of the device's 800×480 screen
  let bgSide = 800 * scale, bgHeight = 480 * scale
  let fit = bgSide / side
  let bgSquare = cover.transformed(by: CGAffineTransform(scaleX: fit, y: fit))
    .cropped(to: CGRect(x: 0, y: 0, width: bgSide, height: bgSide))

  // Mirrored copies either side, so the blur there mixes in matching colour rather than darkening
  // the edges; past those, edge pixels repeat.
  let left = bgSquare.transformed(by: CGAffineTransform(scaleX: -1, y: 1))
  let right = left.transformed(by: CGAffineTransform(translationX: 2 * bgSide, y: 0))
  let strip = bgSquare.composited(over: left).composited(over: right).clampedToExtent()

  // CSS blur(50px) is a Gaussian with a 50px standard deviation, as is CIGaussianBlur's radius.
  let blurred = strip.applyingGaussianBlur(sigma: 50 * scale)

  // CSS saturate(1.6), with the matrix the Filter Effects spec gives for it.
  let s: CGFloat = 1.6
  let saturated = blurred.applyingFilter("CIColorMatrix", parameters: [
    "inputRVector": CIVector(x: 0.213 + 0.787 * s, y: 0.715 - 0.715 * s, z: 0.072 - 0.072 * s, w: 0),
    "inputGVector": CIVector(x: 0.213 - 0.213 * s, y: 0.715 + 0.285 * s, z: 0.072 - 0.072 * s, w: 0),
    "inputBVector": CIVector(x: 0.213 - 0.213 * s, y: 0.715 - 0.715 * s, z: 0.072 + 0.928 * s, w: 0),
    "inputAVector": CIVector(x: 0, y: 0, z: 0, w: 1),
  ])

  // The screen's window onto the square: its middle 480 of 800 rows.
  let background = atOrigin(saturated.cropped(to: CGRect(x: 0, y: (bgSide - bgHeight) / 2, width: bgSide, height: bgHeight)))

  // Browsers apply CSS filters to sRGB values as they are, so blur in sRGB rather than linear light.
  let bgContext = CIContext(options: [.workingColorSpace: srgb, .outputColorSpace: srgb])
  do {
    try writeJPEG(background, args[5], quality: 0.85, context: bgContext)
    tint = backgroundTint(background, context: bgContext)
  } catch {
    FileHandle.standardError.write("artwork: background: \(error.localizedDescription)\n".data(using: .utf8)!)
  }
}

let tintField = tint.map { ",\"tint\":" + $0 } ?? ""
let wideField = wideWidth > 0 ? ",\"wideWidth\":\(wideWidth),\"wideHeight\":\(wideHeight)" : ""
print("{\"width\":\(Int(side)),\"height\":\(Int(side))\(wideField)\(tintField)}")
