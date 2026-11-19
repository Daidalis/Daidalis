package SedanAppearance {
 private import ScalarValues::*; private import ISQ::*; private import SI::*;
 doc /* Units mm, +X forward, +Z up. Symmetric longitudinal inspection cut. The same geometric sections generate Sedan.scad; section solids are geometric controls, not assembly components. */
 part sedan {
 part floorLeft { attribute shape="box"; attribute color="slategray"; attribute length=2480[mm]; attribute width=170[mm]; attribute height=55[mm]; attribute centerX=-150[mm]; attribute centerY=655[mm]; attribute centerZ=365[mm]; }
 part floorRight { attribute shape="box"; attribute color="slategray"; attribute length=2480[mm]; attribute width=170[mm]; attribute height=55[mm]; attribute centerX=-150[mm]; attribute centerY=-655[mm]; attribute centerZ=365[mm]; }
 part battery { attribute shape="box"; attribute color="darkorange"; attribute length=2180[mm]; attribute width=1100[mm]; attribute height=150[mm]; attribute centerX=-150[mm]; attribute centerY=0[mm]; attribute centerZ=255[mm]; }
 part inverter { attribute shape="box"; attribute color="deepskyblue"; attribute length=340[mm]; attribute width=540[mm]; attribute height=180[mm]; attribute centerX=1610[mm]; attribute centerY=0[mm]; attribute centerZ=650[mm]; }
 part motor { attribute shape="cylinder"; attribute color="mediumseagreen"; attribute radius=180[mm]; attribute height=610[mm]; attribute axis="Y"; attribute centerX=1350[mm]; attribute centerY=0[mm]; attribute centerZ=395[mm]; }
 part frontLeftTire { attribute shape="cylinder"; attribute color="dimgray"; attribute radius=330[mm]; attribute height=215[mm]; attribute axis="Y"; attribute centerX=1400[mm]; attribute centerY=850[mm]; attribute centerZ=330[mm]; }
 part frontLeftRim { attribute shape="cylinder"; attribute color="silver"; attribute radius=235[mm]; attribute height=12[mm]; attribute axis="Y"; attribute centerX=1400[mm]; attribute centerY=964[mm]; attribute centerZ=330[mm]; }
 part frontLeftArm { attribute shape="box"; attribute color="steelblue"; attribute length=340[mm]; attribute width=65[mm]; attribute height=40[mm]; attribute centerX=1400[mm]; attribute centerY=555[mm]; attribute centerZ=285[mm]; }
 part frontLeftSpring { attribute shape="cylinder"; attribute color="goldenrod"; attribute radius=55[mm]; attribute height=230[mm]; attribute axis="Z"; attribute centerX=1400[mm]; attribute centerY=690[mm]; attribute centerZ=480[mm]; }
 part frontLeftHalfshaft { attribute shape="cylinder"; attribute color="silver"; attribute radius=22[mm]; attribute height=390[mm]; attribute axis="Y"; attribute centerX=1350[mm]; attribute centerY=520[mm]; attribute centerZ=395[mm]; }
 part frontRightTire { attribute shape="cylinder"; attribute color="dimgray"; attribute radius=330[mm]; attribute height=215[mm]; attribute axis="Y"; attribute centerX=1400[mm]; attribute centerY=-850[mm]; attribute centerZ=330[mm]; }
 part frontRightRim { attribute shape="cylinder"; attribute color="silver"; attribute radius=235[mm]; attribute height=12[mm]; attribute axis="Y"; attribute centerX=1400[mm]; attribute centerY=-964[mm]; attribute centerZ=330[mm]; }
 part frontRightArm { attribute shape="box"; attribute color="steelblue"; attribute length=340[mm]; attribute width=65[mm]; attribute height=40[mm]; attribute centerX=1400[mm]; attribute centerY=-555[mm]; attribute centerZ=285[mm]; }
 part frontRightSpring { attribute shape="cylinder"; attribute color="goldenrod"; attribute radius=55[mm]; attribute height=230[mm]; attribute axis="Z"; attribute centerX=1400[mm]; attribute centerY=-690[mm]; attribute centerZ=480[mm]; }
 part frontRightHalfshaft { attribute shape="cylinder"; attribute color="silver"; attribute radius=22[mm]; attribute height=390[mm]; attribute axis="Y"; attribute centerX=1350[mm]; attribute centerY=-520[mm]; attribute centerZ=395[mm]; }
 part rearLeftTire { attribute shape="cylinder"; attribute color="dimgray"; attribute radius=330[mm]; attribute height=215[mm]; attribute axis="Y"; attribute centerX=-1400[mm]; attribute centerY=850[mm]; attribute centerZ=330[mm]; }
 part rearLeftRim { attribute shape="cylinder"; attribute color="silver"; attribute radius=235[mm]; attribute height=12[mm]; attribute axis="Y"; attribute centerX=-1400[mm]; attribute centerY=964[mm]; attribute centerZ=330[mm]; }
 part rearLeftArm { attribute shape="box"; attribute color="steelblue"; attribute length=340[mm]; attribute width=65[mm]; attribute height=40[mm]; attribute centerX=-1400[mm]; attribute centerY=555[mm]; attribute centerZ=285[mm]; }
 part rearLeftSpring { attribute shape="cylinder"; attribute color="goldenrod"; attribute radius=55[mm]; attribute height=230[mm]; attribute axis="Z"; attribute centerX=-1400[mm]; attribute centerY=690[mm]; attribute centerZ=480[mm]; }
 part rearRightTire { attribute shape="cylinder"; attribute color="dimgray"; attribute radius=330[mm]; attribute height=215[mm]; attribute axis="Y"; attribute centerX=-1400[mm]; attribute centerY=-850[mm]; attribute centerZ=330[mm]; }
 part rearRightRim { attribute shape="cylinder"; attribute color="silver"; attribute radius=235[mm]; attribute height=12[mm]; attribute axis="Y"; attribute centerX=-1400[mm]; attribute centerY=-964[mm]; attribute centerZ=330[mm]; }
 part rearRightArm { attribute shape="box"; attribute color="steelblue"; attribute length=340[mm]; attribute width=65[mm]; attribute height=40[mm]; attribute centerX=-1400[mm]; attribute centerY=-555[mm]; attribute centerZ=285[mm]; }
 part rearRightSpring { attribute shape="cylinder"; attribute color="goldenrod"; attribute radius=55[mm]; attribute height=230[mm]; attribute axis="Z"; attribute centerX=-1400[mm]; attribute centerY=-690[mm]; attribute centerZ=480[mm]; }
 part frontRightFrameRail { attribute shape="box"; attribute color="slategray"; attribute length=640[mm]; attribute width=65[mm]; attribute height=70[mm]; attribute centerX=1400[mm]; attribute centerY=-420[mm]; attribute centerZ=190[mm]; }
 part frontLeftFrameRail { attribute shape="box"; attribute color="slategray"; attribute length=640[mm]; attribute width=65[mm]; attribute height=70[mm]; attribute centerX=1400[mm]; attribute centerY=420[mm]; attribute centerZ=190[mm]; }
 part frontACrossmember { attribute shape="box"; attribute color="slategray"; attribute length=55[mm]; attribute width=780[mm]; attribute height=65[mm]; attribute centerX=1100[mm]; attribute centerY=0[mm]; attribute centerZ=190[mm]; }
 part frontBCrossmember { attribute shape="box"; attribute color="slategray"; attribute length=55[mm]; attribute width=780[mm]; attribute height=65[mm]; attribute centerX=1700[mm]; attribute centerY=0[mm]; attribute centerZ=190[mm]; }
 part rearRightFrameRail { attribute shape="box"; attribute color="slategray"; attribute length=640[mm]; attribute width=65[mm]; attribute height=70[mm]; attribute centerX=-1400[mm]; attribute centerY=-420[mm]; attribute centerZ=190[mm]; }
 part rearLeftFrameRail { attribute shape="box"; attribute color="slategray"; attribute length=640[mm]; attribute width=65[mm]; attribute height=70[mm]; attribute centerX=-1400[mm]; attribute centerY=420[mm]; attribute centerZ=190[mm]; }
 part rearACrossmember { attribute shape="box"; attribute color="slategray"; attribute length=55[mm]; attribute width=780[mm]; attribute height=65[mm]; attribute centerX=-1700[mm]; attribute centerY=0[mm]; attribute centerZ=190[mm]; }
 part rearBCrossmember { attribute shape="box"; attribute color="slategray"; attribute length=55[mm]; attribute width=780[mm]; attribute height=65[mm]; attribute centerX=-1100[mm]; attribute centerY=0[mm]; attribute centerZ=190[mm]; }
 part leftShoulder { attribute shape="loft"; attribute color="royalblue";
 part section0 { attribute centerX=-2300[mm]; attribute centerY=635[mm]; attribute centerZ=710[mm]; attribute width=45[mm]; attribute height=22[mm]; }
 part section1 { attribute centerX=-1900[mm]; attribute centerY=835[mm]; attribute centerZ=850[mm]; attribute width=75[mm]; attribute height=24[mm]; }
 part section2 { attribute centerX=-1000[mm]; attribute centerY=860[mm]; attribute centerZ=925[mm]; attribute width=120[mm]; attribute height=24[mm]; }
 part section3 { attribute centerX=-250[mm]; attribute centerY=855[mm]; attribute centerZ=1040[mm]; attribute width=130[mm]; attribute height=24[mm]; }
 part section4 { attribute centerX=400[mm]; attribute centerY=855[mm]; attribute centerZ=1020[mm]; attribute width=130[mm]; attribute height=24[mm]; }
 part section5 { attribute centerX=1000[mm]; attribute centerY=860[mm]; attribute centerZ=930[mm]; attribute width=120[mm]; attribute height=24[mm]; }
 part section6 { attribute centerX=1900[mm]; attribute centerY=835[mm]; attribute centerZ=820[mm]; attribute width=75[mm]; attribute height=24[mm]; }
 part section7 { attribute centerX=2300[mm]; attribute centerY=635[mm]; attribute centerZ=685[mm]; attribute width=45[mm]; attribute height=22[mm]; }
 }
 part rightShoulder { attribute shape="loft"; attribute color="royalblue";
 part section0 { attribute centerX=-2300[mm]; attribute centerY=-635[mm]; attribute centerZ=710[mm]; attribute width=45[mm]; attribute height=22[mm]; }
 part section1 { attribute centerX=-1900[mm]; attribute centerY=-835[mm]; attribute centerZ=850[mm]; attribute width=75[mm]; attribute height=24[mm]; }
 part section2 { attribute centerX=-1000[mm]; attribute centerY=-860[mm]; attribute centerZ=925[mm]; attribute width=120[mm]; attribute height=24[mm]; }
 part section3 { attribute centerX=-250[mm]; attribute centerY=-855[mm]; attribute centerZ=1040[mm]; attribute width=130[mm]; attribute height=24[mm]; }
 part section4 { attribute centerX=400[mm]; attribute centerY=-855[mm]; attribute centerZ=1020[mm]; attribute width=130[mm]; attribute height=24[mm]; }
 part section5 { attribute centerX=1000[mm]; attribute centerY=-860[mm]; attribute centerZ=930[mm]; attribute width=120[mm]; attribute height=24[mm]; }
 part section6 { attribute centerX=1900[mm]; attribute centerY=-835[mm]; attribute centerZ=820[mm]; attribute width=75[mm]; attribute height=24[mm]; }
 part section7 { attribute centerX=2300[mm]; attribute centerY=-635[mm]; attribute centerZ=685[mm]; attribute width=45[mm]; attribute height=22[mm]; }
 }
 part leftRoof { attribute shape="loft"; attribute color="royalblue";
 part section0 { attribute centerX=-2300[mm]; attribute centerY=625[mm]; attribute centerZ=735[mm]; attribute width=30[mm]; attribute height=14[mm]; }
 part section1 { attribute centerX=-1850[mm]; attribute centerY=730[mm]; attribute centerZ=875[mm]; attribute width=200[mm]; attribute height=14[mm]; }
 part section2 { attribute centerX=-1000[mm]; attribute centerY=730[mm]; attribute centerZ=1090[mm]; attribute width=200[mm]; attribute height=14[mm]; }
 part section3 { attribute centerX=-500[mm]; attribute centerY=700[mm]; attribute centerZ=1420[mm]; attribute width=140[mm]; attribute height=14[mm]; }
 part section4 { attribute centerX=-200[mm]; attribute centerY=700[mm]; attribute centerZ=1490[mm]; attribute width=140[mm]; attribute height=14[mm]; }
 part section5 { attribute centerX=200[mm]; attribute centerY=700[mm]; attribute centerZ=1470[mm]; attribute width=140[mm]; attribute height=14[mm]; }
 part section6 { attribute centerX=500[mm]; attribute centerY=700[mm]; attribute centerZ=1350[mm]; attribute width=140[mm]; attribute height=14[mm]; }
 part section7 { attribute centerX=1000[mm]; attribute centerY=730[mm]; attribute centerZ=990[mm]; attribute width=200[mm]; attribute height=14[mm]; }
 part section8 { attribute centerX=1850[mm]; attribute centerY=730[mm]; attribute centerZ=850[mm]; attribute width=200[mm]; attribute height=14[mm]; }
 part section9 { attribute centerX=2300[mm]; attribute centerY=625[mm]; attribute centerZ=710[mm]; attribute width=30[mm]; attribute height=14[mm]; }
 }
 part rightRoof { attribute shape="loft"; attribute color="royalblue";
 part section0 { attribute centerX=-2300[mm]; attribute centerY=-625[mm]; attribute centerZ=735[mm]; attribute width=30[mm]; attribute height=14[mm]; }
 part section1 { attribute centerX=-1850[mm]; attribute centerY=-730[mm]; attribute centerZ=875[mm]; attribute width=200[mm]; attribute height=14[mm]; }
 part section2 { attribute centerX=-1000[mm]; attribute centerY=-730[mm]; attribute centerZ=1090[mm]; attribute width=200[mm]; attribute height=14[mm]; }
 part section3 { attribute centerX=-500[mm]; attribute centerY=-700[mm]; attribute centerZ=1420[mm]; attribute width=140[mm]; attribute height=14[mm]; }
 part section4 { attribute centerX=-200[mm]; attribute centerY=-700[mm]; attribute centerZ=1490[mm]; attribute width=140[mm]; attribute height=14[mm]; }
 part section5 { attribute centerX=200[mm]; attribute centerY=-700[mm]; attribute centerZ=1470[mm]; attribute width=140[mm]; attribute height=14[mm]; }
 part section6 { attribute centerX=500[mm]; attribute centerY=-700[mm]; attribute centerZ=1350[mm]; attribute width=140[mm]; attribute height=14[mm]; }
 part section7 { attribute centerX=1000[mm]; attribute centerY=-730[mm]; attribute centerZ=990[mm]; attribute width=200[mm]; attribute height=14[mm]; }
 part section8 { attribute centerX=1850[mm]; attribute centerY=-730[mm]; attribute centerZ=850[mm]; attribute width=200[mm]; attribute height=14[mm]; }
 part section9 { attribute centerX=2300[mm]; attribute centerY=-625[mm]; attribute centerZ=710[mm]; attribute width=30[mm]; attribute height=14[mm]; }
 }
 part leftGlass { attribute shape="loft"; attribute color="lightsteelblue";
 part section0 { attribute centerX=-990[mm]; attribute centerY=805[mm]; attribute centerZ=1000[mm]; attribute width=12[mm]; attribute height=120[mm]; }
 part section1 { attribute centerX=-500[mm]; attribute centerY=780[mm]; attribute centerZ=1215[mm]; attribute width=12[mm]; attribute height=385[mm]; }
 part section2 { attribute centerX=-200[mm]; attribute centerY=780[mm]; attribute centerZ=1265[mm]; attribute width=12[mm]; attribute height=430[mm]; }
 part section3 { attribute centerX=200[mm]; attribute centerY=780[mm]; attribute centerZ=1250[mm]; attribute width=12[mm]; attribute height=420[mm]; }
 part section4 { attribute centerX=500[mm]; attribute centerY=780[mm]; attribute centerZ=1175[mm]; attribute width=12[mm]; attribute height=315[mm]; }
 part section5 { attribute centerX=990[mm]; attribute centerY=805[mm]; attribute centerZ=955[mm]; attribute width=12[mm]; attribute height=45[mm]; }
 }
 part rightGlass { attribute shape="loft"; attribute color="lightsteelblue";
 part section0 { attribute centerX=-990[mm]; attribute centerY=-805[mm]; attribute centerZ=1000[mm]; attribute width=12[mm]; attribute height=120[mm]; }
 part section1 { attribute centerX=-500[mm]; attribute centerY=-780[mm]; attribute centerZ=1215[mm]; attribute width=12[mm]; attribute height=385[mm]; }
 part section2 { attribute centerX=-200[mm]; attribute centerY=-780[mm]; attribute centerZ=1265[mm]; attribute width=12[mm]; attribute height=430[mm]; }
 part section3 { attribute centerX=200[mm]; attribute centerY=-780[mm]; attribute centerZ=1250[mm]; attribute width=12[mm]; attribute height=420[mm]; }
 part section4 { attribute centerX=500[mm]; attribute centerY=-780[mm]; attribute centerZ=1175[mm]; attribute width=12[mm]; attribute height=315[mm]; }
 part section5 { attribute centerX=990[mm]; attribute centerY=-805[mm]; attribute centerZ=955[mm]; attribute width=12[mm]; attribute height=45[mm]; }
 }
 part leftDoorSkin { attribute shape="loft"; attribute color="royalblue";
 part section0 { attribute centerX=-1010[mm]; attribute centerY=890[mm]; attribute centerZ=630[mm]; attribute width=24[mm]; attribute height=500[mm]; }
 part section1 { attribute centerX=-300[mm]; attribute centerY=910[mm]; attribute centerZ=660[mm]; attribute width=24[mm]; attribute height=560[mm]; }
 part section2 { attribute centerX=400[mm]; attribute centerY=910[mm]; attribute centerZ=655[mm]; attribute width=24[mm]; attribute height=550[mm]; }
 part section3 { attribute centerX=1010[mm]; attribute centerY=890[mm]; attribute centerZ=630[mm]; attribute width=24[mm]; attribute height=500[mm]; }
 }
 part rightDoorSkin { attribute shape="loft"; attribute color="royalblue";
 part section0 { attribute centerX=-1010[mm]; attribute centerY=-890[mm]; attribute centerZ=630[mm]; attribute width=24[mm]; attribute height=500[mm]; }
 part section1 { attribute centerX=-300[mm]; attribute centerY=-910[mm]; attribute centerZ=660[mm]; attribute width=24[mm]; attribute height=560[mm]; }
 part section2 { attribute centerX=400[mm]; attribute centerY=-910[mm]; attribute centerZ=655[mm]; attribute width=24[mm]; attribute height=550[mm]; }
 part section3 { attribute centerX=1010[mm]; attribute centerY=-890[mm]; attribute centerZ=630[mm]; attribute width=24[mm]; attribute height=500[mm]; }
 }
 part leftFrontArch { attribute shape="loft"; attribute color="royalblue";
 part section0 { attribute centerX=1020[mm]; attribute centerY=890[mm]; attribute centerZ=820[mm]; attribute width=24[mm]; attribute height=180[mm]; }
 part section1 { attribute centerX=1400[mm]; attribute centerY=900[mm]; attribute centerZ=785[mm]; attribute width=24[mm]; attribute height=140[mm]; }
 part section2 { attribute centerX=1780[mm]; attribute centerY=870[mm]; attribute centerZ=760[mm]; attribute width=24[mm]; attribute height=70[mm]; }
 }
 part rightFrontArch { attribute shape="loft"; attribute color="royalblue";
 part section0 { attribute centerX=1020[mm]; attribute centerY=-890[mm]; attribute centerZ=820[mm]; attribute width=24[mm]; attribute height=180[mm]; }
 part section1 { attribute centerX=1400[mm]; attribute centerY=-900[mm]; attribute centerZ=785[mm]; attribute width=24[mm]; attribute height=140[mm]; }
 part section2 { attribute centerX=1780[mm]; attribute centerY=-870[mm]; attribute centerZ=760[mm]; attribute width=24[mm]; attribute height=70[mm]; }
 }
 part leftRearArch { attribute shape="loft"; attribute color="royalblue";
 part section0 { attribute centerX=-1780[mm]; attribute centerY=870[mm]; attribute centerZ=800[mm]; attribute width=24[mm]; attribute height=140[mm]; }
 part section1 { attribute centerX=-1400[mm]; attribute centerY=900[mm]; attribute centerZ=815[mm]; attribute width=24[mm]; attribute height=170[mm]; }
 part section2 { attribute centerX=-1020[mm]; attribute centerY=890[mm]; attribute centerZ=850[mm]; attribute width=24[mm]; attribute height=220[mm]; }
 }
 part rightRearArch { attribute shape="loft"; attribute color="royalblue";
 part section0 { attribute centerX=-1780[mm]; attribute centerY=-870[mm]; attribute centerZ=800[mm]; attribute width=24[mm]; attribute height=140[mm]; }
 part section1 { attribute centerX=-1400[mm]; attribute centerY=-900[mm]; attribute centerZ=815[mm]; attribute width=24[mm]; attribute height=170[mm]; }
 part section2 { attribute centerX=-1020[mm]; attribute centerY=-890[mm]; attribute centerZ=850[mm]; attribute width=24[mm]; attribute height=220[mm]; }
 }
 part leftNose { attribute shape="loft"; attribute color="royalblue";
 part section0 { attribute centerX=1790[mm]; attribute centerY=870[mm]; attribute centerZ=550[mm]; attribute width=24[mm]; attribute height=320[mm]; }
 part section1 { attribute centerX=2200[mm]; attribute centerY=755[mm]; attribute centerZ=540[mm]; attribute width=24[mm]; attribute height=280[mm]; }
 part section2 { attribute centerX=2300[mm]; attribute centerY=635[mm]; attribute centerZ=535[mm]; attribute width=24[mm]; attribute height=250[mm]; }
 }
 part rightNose { attribute shape="loft"; attribute color="royalblue";
 part section0 { attribute centerX=1790[mm]; attribute centerY=-870[mm]; attribute centerZ=550[mm]; attribute width=24[mm]; attribute height=320[mm]; }
 part section1 { attribute centerX=2200[mm]; attribute centerY=-755[mm]; attribute centerZ=540[mm]; attribute width=24[mm]; attribute height=280[mm]; }
 part section2 { attribute centerX=2300[mm]; attribute centerY=-635[mm]; attribute centerZ=535[mm]; attribute width=24[mm]; attribute height=250[mm]; }
 }
 part leftTail { attribute shape="loft"; attribute color="royalblue";
 part section0 { attribute centerX=-2300[mm]; attribute centerY=635[mm]; attribute centerZ=545[mm]; attribute width=24[mm]; attribute height=260[mm]; }
 part section1 { attribute centerX=-2200[mm]; attribute centerY=755[mm]; attribute centerZ=555[mm]; attribute width=24[mm]; attribute height=300[mm]; }
 part section2 { attribute centerX=-1790[mm]; attribute centerY=870[mm]; attribute centerZ=575[mm]; attribute width=24[mm]; attribute height=360[mm]; }
 }
 part rightTail { attribute shape="loft"; attribute color="royalblue";
 part section0 { attribute centerX=-2300[mm]; attribute centerY=-635[mm]; attribute centerZ=545[mm]; attribute width=24[mm]; attribute height=260[mm]; }
 part section1 { attribute centerX=-2200[mm]; attribute centerY=-755[mm]; attribute centerZ=555[mm]; attribute width=24[mm]; attribute height=300[mm]; }
 part section2 { attribute centerX=-1790[mm]; attribute centerY=-870[mm]; attribute centerZ=575[mm]; attribute width=24[mm]; attribute height=360[mm]; }
 }
 part leftSill { attribute shape="loft"; attribute color="midnightblue";
 part section0 { attribute centerX=-1010[mm]; attribute centerY=850[mm]; attribute centerZ=365[mm]; attribute width=90[mm]; attribute height=65[mm]; }
 part section1 { attribute centerX=0[mm]; attribute centerY=870[mm]; attribute centerZ=355[mm]; attribute width=90[mm]; attribute height=65[mm]; }
 part section2 { attribute centerX=1010[mm]; attribute centerY=850[mm]; attribute centerZ=365[mm]; attribute width=90[mm]; attribute height=65[mm]; }
 }
 part rightSill { attribute shape="loft"; attribute color="midnightblue";
 part section0 { attribute centerX=-1010[mm]; attribute centerY=-850[mm]; attribute centerZ=365[mm]; attribute width=90[mm]; attribute height=65[mm]; }
 part section1 { attribute centerX=0[mm]; attribute centerY=-870[mm]; attribute centerZ=355[mm]; attribute width=90[mm]; attribute height=65[mm]; }
 part section2 { attribute centerX=1010[mm]; attribute centerY=-850[mm]; attribute centerZ=365[mm]; attribute width=90[mm]; attribute height=65[mm]; }
 }
 part leftBeltline { attribute shape="loft"; attribute color="silver";
 part section0 { attribute centerX=-1010[mm]; attribute centerY=905[mm]; attribute centerZ=890[mm]; attribute width=20[mm]; attribute height=20[mm]; }
 part section1 { attribute centerX=0[mm]; attribute centerY=925[mm]; attribute centerZ=950[mm]; attribute width=20[mm]; attribute height=20[mm]; }
 part section2 { attribute centerX=1010[mm]; attribute centerY=905[mm]; attribute centerZ=890[mm]; attribute width=20[mm]; attribute height=20[mm]; }
 }
 part rightBeltline { attribute shape="loft"; attribute color="silver";
 part section0 { attribute centerX=-1010[mm]; attribute centerY=-905[mm]; attribute centerZ=890[mm]; attribute width=20[mm]; attribute height=20[mm]; }
 part section1 { attribute centerX=0[mm]; attribute centerY=-925[mm]; attribute centerZ=950[mm]; attribute width=20[mm]; attribute height=20[mm]; }
 part section2 { attribute centerX=1010[mm]; attribute centerY=-905[mm]; attribute centerZ=890[mm]; attribute width=20[mm]; attribute height=20[mm]; }
 }
 part leftRoofRail { attribute shape="loft"; attribute color="midnightblue";
 part section0 { attribute centerX=-1000[mm]; attribute centerY=650[mm]; attribute centerZ=1100[mm]; attribute width=32[mm]; attribute height=32[mm]; }
 part section1 { attribute centerX=-500[mm]; attribute centerY=650[mm]; attribute centerZ=1435[mm]; attribute width=32[mm]; attribute height=32[mm]; }
 part section2 { attribute centerX=-200[mm]; attribute centerY=650[mm]; attribute centerZ=1505[mm]; attribute width=32[mm]; attribute height=32[mm]; }
 part section3 { attribute centerX=200[mm]; attribute centerY=650[mm]; attribute centerZ=1485[mm]; attribute width=32[mm]; attribute height=32[mm]; }
 part section4 { attribute centerX=500[mm]; attribute centerY=650[mm]; attribute centerZ=1365[mm]; attribute width=32[mm]; attribute height=32[mm]; }
 part section5 { attribute centerX=1000[mm]; attribute centerY=650[mm]; attribute centerZ=1005[mm]; attribute width=32[mm]; attribute height=32[mm]; }
 }
 part rightRoofRail { attribute shape="loft"; attribute color="midnightblue";
 part section0 { attribute centerX=-1000[mm]; attribute centerY=-650[mm]; attribute centerZ=1100[mm]; attribute width=32[mm]; attribute height=32[mm]; }
 part section1 { attribute centerX=-500[mm]; attribute centerY=-650[mm]; attribute centerZ=1435[mm]; attribute width=32[mm]; attribute height=32[mm]; }
 part section2 { attribute centerX=-200[mm]; attribute centerY=-650[mm]; attribute centerZ=1505[mm]; attribute width=32[mm]; attribute height=32[mm]; }
 part section3 { attribute centerX=200[mm]; attribute centerY=-650[mm]; attribute centerZ=1485[mm]; attribute width=32[mm]; attribute height=32[mm]; }
 part section4 { attribute centerX=500[mm]; attribute centerY=-650[mm]; attribute centerZ=1365[mm]; attribute width=32[mm]; attribute height=32[mm]; }
 part section5 { attribute centerX=1000[mm]; attribute centerY=-650[mm]; attribute centerZ=1005[mm]; attribute width=32[mm]; attribute height=32[mm]; }
 }
 part leftHeadlight { attribute shape="loft"; attribute color="lightyellow";
 part section0 { attribute centerX=2210[mm]; attribute centerY=565[mm]; attribute centerZ=690[mm]; attribute width=270[mm]; attribute height=48[mm]; }
 part section1 { attribute centerX=2280[mm]; attribute centerY=530[mm]; attribute centerZ=675[mm]; attribute width=230[mm]; attribute height=42[mm]; }
 }
 part rightHeadlight { attribute shape="loft"; attribute color="lightyellow";
 part section0 { attribute centerX=2210[mm]; attribute centerY=-565[mm]; attribute centerZ=690[mm]; attribute width=270[mm]; attribute height=48[mm]; }
 part section1 { attribute centerX=2280[mm]; attribute centerY=-530[mm]; attribute centerZ=675[mm]; attribute width=230[mm]; attribute height=42[mm]; }
 }
 part leftTaillight { attribute shape="loft"; attribute color="crimson";
 part section0 { attribute centerX=-2290[mm]; attribute centerY=520[mm]; attribute centerZ=690[mm]; attribute width=240[mm]; attribute height=45[mm]; }
 part section1 { attribute centerX=-2220[mm]; attribute centerY=565[mm]; attribute centerZ=715[mm]; attribute width=280[mm]; attribute height=50[mm]; }
 }
 part rightTaillight { attribute shape="loft"; attribute color="crimson";
 part section0 { attribute centerX=-2290[mm]; attribute centerY=-520[mm]; attribute centerZ=690[mm]; attribute width=240[mm]; attribute height=45[mm]; }
 part section1 { attribute centerX=-2220[mm]; attribute centerY=-565[mm]; attribute centerZ=715[mm]; attribute width=280[mm]; attribute height=50[mm]; }
 }
 part leftMirrorStem { attribute shape="box"; attribute color="dimgray"; attribute length=95[mm]; attribute width=70[mm]; attribute height=28[mm]; attribute centerX=700[mm]; attribute centerY=950[mm]; attribute centerZ=1020[mm]; }
 part rightMirrorStem { attribute shape="box"; attribute color="dimgray"; attribute length=95[mm]; attribute width=70[mm]; attribute height=28[mm]; attribute centerX=700[mm]; attribute centerY=-950[mm]; attribute centerZ=1020[mm]; }
 part leftMirror { attribute shape="loft"; attribute color="royalblue";
 part section0 { attribute centerX=640[mm]; attribute centerY=1020[mm]; attribute centerZ=1040[mm]; attribute width=115[mm]; attribute height=65[mm]; }
 part section1 { attribute centerX=690[mm]; attribute centerY=1035[mm]; attribute centerZ=1050[mm]; attribute width=150[mm]; attribute height=80[mm]; }
 part section2 { attribute centerX=770[mm]; attribute centerY=1020[mm]; attribute centerZ=1040[mm]; attribute width=105[mm]; attribute height=60[mm]; }
 }
 part rightMirror { attribute shape="loft"; attribute color="royalblue";
 part section0 { attribute centerX=640[mm]; attribute centerY=-1020[mm]; attribute centerZ=1040[mm]; attribute width=115[mm]; attribute height=65[mm]; }
 part section1 { attribute centerX=690[mm]; attribute centerY=-1035[mm]; attribute centerZ=1050[mm]; attribute width=150[mm]; attribute height=80[mm]; }
 part section2 { attribute centerX=770[mm]; attribute centerY=-1020[mm]; attribute centerZ=1040[mm]; attribute width=105[mm]; attribute height=60[mm]; }
 }
 part frontBumper { attribute shape="box"; attribute color="midnightblue"; attribute length=45[mm]; attribute width=1290[mm]; attribute height=120[mm]; attribute centerX=2280[mm]; attribute centerY=0[mm]; attribute centerZ=470[mm]; }
 part rearBumper { attribute shape="box"; attribute color="midnightblue"; attribute length=45[mm]; attribute width=1290[mm]; attribute height=120[mm]; attribute centerX=-2280[mm]; attribute centerY=0[mm]; attribute centerZ=470[mm]; }
 }
}
