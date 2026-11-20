package SedanAppearance {
    private import ScalarValues::*;
    private import ISQ::*;
    private import SI::*;
    doc /* Concept sedan, all lengths mm; +X forward, +Z up. Open centre and foredeck expose powertrain. */
    part sedan {
        part floorLeft { attribute shape = "box"; attribute length = 2480 [mm]; attribute width = 170 [mm]; attribute height = 55 [mm]; attribute centerX = -150 [mm]; attribute centerY = 655 [mm]; attribute centerZ = 365 [mm]; }
        part floorRight { attribute shape = "box"; attribute length = 2480 [mm]; attribute width = 170 [mm]; attribute height = 55 [mm]; attribute centerX = -150 [mm]; attribute centerY = -655 [mm]; attribute centerZ = 365 [mm]; }
        part battery { attribute shape = "box"; attribute length = 2180 [mm]; attribute width = 1100 [mm]; attribute height = 150 [mm]; attribute centerX = -150 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 255 [mm]; }
        part inverter { attribute shape = "box"; attribute length = 340 [mm]; attribute width = 540 [mm]; attribute height = 180 [mm]; attribute centerX = 1610 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 650 [mm]; }
        part motor { attribute shape = "cylinder"; attribute radius = 180 [mm]; attribute height = 610 [mm]; attribute axis = "Y"; attribute centerX = 1350 [mm]; attribute centerY = 0 [mm]; attribute centerZ = 395 [mm]; }
    }
}
