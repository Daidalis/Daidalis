package SedanAppearance {
 private import ScalarValues::*; private import ISQ::*; private import SI::*;
 part sedan {
 part floorLeft { attribute length=2480[mm]; attribute width=170[mm]; attribute height=55[mm]; attribute centerX=-150[mm]; attribute centerY=655[mm]; attribute centerZ=365[mm]; }
 part floorRight { attribute length=2480[mm]; attribute width=170[mm]; attribute height=55[mm]; attribute centerX=-150[mm]; attribute centerY=-655[mm]; attribute centerZ=365[mm]; }
 part battery { attribute length=2180[mm]; attribute width=1100[mm]; attribute height=150[mm]; attribute centerX=-150[mm]; attribute centerY=0[mm]; attribute centerZ=255[mm]; }
 part inverter { attribute length=340[mm]; attribute width=540[mm]; attribute height=180[mm]; attribute centerX=1610[mm]; attribute centerY=0[mm]; attribute centerZ=650[mm]; }
 part motor { attribute shape="cylinder"; attribute radius=180[mm]; attribute height=610[mm]; attribute axis="Y"; attribute centerX=1350[mm]; attribute centerY=0[mm]; attribute centerZ=395[mm]; }
 part frontLeftTire { attribute shape="cylinder"; attribute radius=330[mm]; attribute height=215[mm]; attribute axis="Y"; attribute centerX=1400[mm]; attribute centerY=850[mm]; attribute centerZ=330[mm]; }
 part frontLeftRim { attribute shape="cylinder"; attribute radius=235[mm]; attribute height=12[mm]; attribute axis="Y"; attribute centerX=1400[mm]; attribute centerY=964[mm]; attribute centerZ=330[mm]; }
 part frontLeftArm { attribute length=340[mm]; attribute width=65[mm]; attribute height=40[mm]; attribute centerX=1400[mm]; attribute centerY=555[mm]; attribute centerZ=285[mm]; }
 part frontLeftSpring { attribute shape="cylinder"; attribute radius=55[mm]; attribute height=230[mm]; attribute axis="Z"; attribute centerX=1400[mm]; attribute centerY=690[mm]; attribute centerZ=480[mm]; }
 part frontLeftHalfshaft { attribute shape="cylinder"; attribute radius=22[mm]; attribute height=390[mm]; attribute axis="Y"; attribute centerX=1350[mm]; attribute centerY=520[mm]; attribute centerZ=395[mm]; }
 }
}
