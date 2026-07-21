# Heightmap-Based Water Shader for OpenMW 0.51
### Ver. 1.0.1
This is a core shader mod for OpenMW 0.51 that attempts to improve the look of the default water.

https://github.com/user-attachments/assets/f38ab83f-d2fb-48fb-8623-4d8b51285b0b

<details>
  <summary>Screenshots</summary>
  <img width="1920" height="1080" alt="Seyda Neen Coastline" src="https://github.com/user-attachments/assets/70265b29-b642-48a4-8298-3191b1fb7b1d" />
  <img width="1920" height="1080" alt="Rain at Wolverine Hall" src="https://github.com/user-attachments/assets/90d80bc7-a84d-442f-aa09-05be80f916c6" />
  <img width="1920" height="1080" alt="Kushtashpi" src="https://github.com/user-attachments/assets/7b277417-fbd4-40f0-8076-fa2b77d87c0e" />
  <img width="1920" height="1080" alt="Vivec Waterways" src="https://github.com/user-attachments/assets/4115c7c1-858a-4767-85c4-160b80147e28" />
</details>

## Features

Instead of scrolling normal maps, this shader uses heightmaps to simulate the water surface, allowing for a more dynamic wave effect.
Other features include exponential light absorption and fogging for refraction, tweaked reflection sampling, and a few miscellaneous bugfixes.

## Installation

1. Find the resources directory inside your OpenMW installation and make a backup of it. Don't put anything in this backup, it's just for uninstalling/reinstalling.
2. Copy the contents of the resources directory provided by this mod into OpenMW's resource directory. This will overwrite several files.
3. Done.

### Compatibility
This shader was created to work with OpenMW 0.51. If you want to use it with development builds of 0.52, you'll need to use the OMW-prerelease branch.

This will likely conflict with other core shader mods. Combine them with caution.

## Credits

Qlonever - Mod author, shader modification

OpenMW contributors - Wrote the shader code this mod is built off of
(https://gitlab.com/OpenMW/openmw/-/tree/openmw-51)
