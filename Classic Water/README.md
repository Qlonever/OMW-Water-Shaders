# Classic Water Shader for OpenMW 0.51
### Ver. 1.3.0
This is a core shader mod for OpenMW 0.51 that aims to recreate the older water shader used by Morrowind.exe. The original pixel shader was picked apart to reproduce the overall look as accurately as possible, though a 100% perfect recreation wasn't achievable for multiple reasons. That being said, I think this will still satisfy anyone trying to get that classic 2002 look.

<img src="https://i.imgur.com/4z2Gkzg.png" alt="Ebonheart at sunset">
<details>
  <summary>Screenshots</summary>
  <img src="https://i.imgur.com/T07BwhQ.png" alt="Lake Amaya">
  <img src="https://i.imgur.com/op0rXbm.png" alt="Water under the bridge">
</details>

## Installation

1. Find the resources directory inside your OpenMW installation and make a backup of it. Don't put anything in this backup, it's just for uninstalling/reinstalling.
2. Copy the contents of the resources directory provided by this mod into OpenMW's resource directory. This will overwrite several files.
3. Done.

### Compatibility
This shader has been updated to work with OpenMW 0.51. If you want to use it with development builds of 0.52, you'll need to use the OMW-prerelease branch.

This will likely conflict with other core shader mods. Combine them with caution.

## Tweakables

The main shader (found at resources/shaders/compatibility/water.frag) contains several tweakable values near the start of the file. The most important ones are listed below.

### DISTORT_RAYMETHOD
#### (Default: true)
Determines how the distortion for reflection/refraction will be calculated. If true, a more realistic ray-based method will be used. If false, a method more similar to the vanilla shader will be used.


These four values are carried over from Morrowind.ini:

### ENV_REDUCE_COLOR
#### (Default: 255, 255, 255)
The water reflection will be tinted this color.

### LERP_CLOSE_COLOR
#### (Default: 37, 46, 48)
The water reflection will fade into this color below the viewpoint.

### BUMP_FADE_COLOR
#### (Default: 230, 239, 255)
The water normal is multiplied by this value during transparency calculations. This doesn't really have a visible effect with the default value.

### ALPHA_REDUCE:
#### (Default: 0.35)
The overall transparency of the water is reduced by this value.

These three values control behavior hard-coded into the vanilla shader:

### LERP_CLOSE_INTENSITY
#### (Default: 1.0)
This controls how intense the viewpoint-based reflection fade is. Keep at 1 for a vanilla-accurate look, or lower it to reduce the effect.

### LERP_CLOSE_AMBIENT
#### (Default: 1.0)
Lowering this reduces the influence of ambient light over the reflection fade color, which can cause water to glow in the dark. For a vanilla-accurate look, set to 0.

### BASE_AMBIENT
#### (Default: 137, 140, 160)
This is the base ambient lighting value already accounted for by LERP_CLOSE_COLOR. Unless you're tweaking that value, you shouldn't have to change this. By default, it is equal to the ambient lighting value on a clear day.

## Credits

Qlonever - Mod author, shader modification

OpenMW contributors - Wrote the shader code this mod is built off of
(https://gitlab.com/OpenMW/openmw/-/tree/openmw-51)

PoodleSandwich, Dassid, Left4No, Vtastek - Created the original vanilla water mod that inspired this one
(https://www.nexusmods.com/morrowind/mods/49391)

Vtastek - Found a method to extract water normal maps from Morrowind, which I used to create this mod's normal map
