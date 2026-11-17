package SedanAppearance {
 private import ScalarValues::*; private import ISQ::*; private import SI::*;
 part def Box { attribute shape : String = "box"; attribute length : LengthValue; attribute width : LengthValue; attribute height : LengthValue; attribute centerX : LengthValue; attribute centerY : LengthValue; attribute centerZ : LengthValue; attribute color : String default = "#607080"; }
 part def Cylinder { attribute shape : String = "cylinder"; attribute radius : LengthValue; attribute height : LengthValue; attribute axis : String default = "Y"; attribute centerX : LengthValue; attribute centerY : LengthValue; attribute centerZ : LengthValue; attribute color : String default = "#30343B"; }
 part def Section { attribute centerX : LengthValue; attribute centerY : LengthValue; attribute centerZ : LengthValue; attribute width : LengthValue; attribute height : LengthValue; }
 part def Tire :> Cylinder { :>> radius=325[mm]; :>> height=215[mm]; :>> centerZ=325[mm]; :>> color="#20252B"; }
 part def Rim :> Cylinder { :>> radius=215[mm]; :>> height=12[mm]; :>> centerZ=325[mm]; :>> color="#B9C6D0"; }
 part def Halfshaft :> Cylinder { :>> radius=24[mm]; :>> height=360[mm]; :>> centerZ=360[mm]; :>> color="#B9C6D0"; }
 part def Arm :> Box { :>> length=280[mm]; :>> width=260[mm]; :>> height=35[mm]; :>> centerZ=210[mm]; }
 part def Strut :> Cylinder { :>> radius=38[mm]; :>> height=330[mm]; :>> axis="Z"; :>> centerZ=540[mm]; :>> color="#B9C6D0"; }
 part def Spring :> Cylinder { :>> radius=62[mm]; :>> height=170[mm]; :>> axis="Z"; :>> centerZ=570[mm]; :>> color="#D49C38"; }
 part def B0 :> Section { :>> centerX=-2300[mm]; :>> centerZ=517.5[mm]; :>> width=50[mm]; :>> height=195[mm]; }
 part def B1 :> Section { :>> centerX=-2100[mm]; :>> centerZ=537.5[mm]; :>> width=50[mm]; :>> height=375[mm]; }
 part def B2 :> Section { :>> centerX=-1750[mm]; :>> centerZ=582.5[mm]; :>> width=50[mm]; :>> height=465[mm]; }
 part def B3 :> Section { :>> centerX=-1500[mm]; :>> centerZ=777.5[mm]; :>> width=50[mm]; :>> height=155[mm]; }
 part def B4 :> Section { :>> centerX=-1350[mm]; :>> centerZ=790[mm]; :>> width=50[mm]; :>> height=150[mm]; }
 part def B5 :> Section { :>> centerX=-1150[mm]; :>> centerZ=770[mm]; :>> width=50[mm]; :>> height=230[mm]; }
 part def B6 :> Section { :>> centerX=-900[mm]; :>> centerZ=627.5[mm]; :>> width=50[mm]; :>> height=555[mm]; }
 part def B7 :> Section { :>> centerX=-500[mm]; :>> centerZ=637.5[mm]; :>> width=50[mm]; :>> height=575[mm]; }
 part def B8 :> Section { :>> centerX=0[mm]; :>> centerZ=642.5[mm]; :>> width=50[mm]; :>> height=585[mm]; }
 part def B9 :> Section { :>> centerX=500[mm]; :>> centerZ=637.5[mm]; :>> width=50[mm]; :>> height=575[mm]; }
 part def B10 :> Section { :>> centerX=900[mm]; :>> centerZ=627.5[mm]; :>> width=50[mm]; :>> height=555[mm]; }
 part def B11 :> Section { :>> centerX=1150[mm]; :>> centerZ=767.5[mm]; :>> width=50[mm]; :>> height=225[mm]; }
 part def B12 :> Section { :>> centerX=1350[mm]; :>> centerZ=790[mm]; :>> width=50[mm]; :>> height=150[mm]; }
 part def B13 :> Section { :>> centerX=1550[mm]; :>> centerZ=745[mm]; :>> width=50[mm]; :>> height=180[mm]; }
 part def B14 :> Section { :>> centerX=1750[mm]; :>> centerZ=572.5[mm]; :>> width=50[mm]; :>> height=445[mm]; }
 part def B15 :> Section { :>> centerX=2100[mm]; :>> centerZ=532.5[mm]; :>> width=50[mm]; :>> height=305[mm]; }
 part def B16 :> Section { :>> centerX=2300[mm]; :>> centerZ=517.5[mm]; :>> width=50[mm]; :>> height=195[mm]; }
 part def ShoulderSection :> Section { :>> width=110[mm]; :>> height=40[mm]; }
 part def HoodSection :> Section { :>> height=26[mm]; }
 part def RailSection :> Section { :>> width=35[mm]; :>> height=30[mm]; }
 part def WaistSection :> Section { :>> width=38[mm]; :>> height=32[mm]; }
 part sedan {
  doc /* Concept assembly, mm. +X front, +Z up, ground Z=0. 4600 length, 2700 wheelbase, 1560 track. Physical longitudinal cutaway, not transparency. All chassis groups retained from successive assembly saves. Flat sections are a faceted loft approximation, not Class-A production surfacing. */
  part floorLeft : Box { :>> length=2680[mm]; :>> width=300[mm]; :>> height=45[mm]; :>> centerX=0[mm]; :>> centerY=550[mm]; :>> centerZ=330[mm]; }
  part floorRight : Box { :>> length=2680[mm]; :>> width=300[mm]; :>> height=45[mm]; :>> centerX=0[mm]; :>> centerY=-550[mm]; :>> centerZ=330[mm]; }
  part battery : Box { :>> length=2150[mm]; :>> width=1240[mm]; :>> height=125[mm]; :>> centerX=-100[mm]; :>> centerY=0[mm]; :>> centerZ=230[mm]; :>> color="#D49C38"; }
  part inverter : Box { :>> length=380[mm]; :>> width=460[mm]; :>> height=150[mm]; :>> centerX=1480[mm]; :>> centerY=0[mm]; :>> centerZ=650[mm]; :>> color="#3EAAAD"; }
  part motor : Cylinder { :>> radius=155[mm]; :>> height=520[mm]; :>> centerX=1420[mm]; :>> centerY=0[mm]; :>> centerZ=420[mm]; :>> color="#C87140"; }
  part frontSubframe : Box { :>> length=260[mm]; :>> width=1150[mm]; :>> height=65[mm]; :>> centerX=1170[mm]; :>> centerY=0[mm]; :>> centerZ=245[mm]; }
  part rearSubframe : Box { :>> length=240[mm]; :>> width=1150[mm]; :>> height=65[mm]; :>> centerX=-1350[mm]; :>> centerY=0[mm]; :>> centerZ=245[mm]; }
  part frontLeftTire : Tire { :>> centerX=1350[mm]; :>> centerY=780[mm]; }
  part frontLeftRim : Rim { :>> centerX=1350[mm]; :>> centerY=895[mm]; }
  part frontLeftHalfshaft : Halfshaft { :>> centerX=1350[mm]; :>> centerY=470[mm]; }
  part frontLeftArm : Arm { :>> centerX=1350[mm]; :>> centerY=540[mm]; }
  part frontLeftStrut : Strut { :>> centerX=1350[mm]; :>> centerY=650[mm]; }
  part frontLeftSpring : Spring { :>> centerX=1350[mm]; :>> centerY=650[mm]; }
  part frontRightTire : Tire { :>> centerX=1350[mm]; :>> centerY=-780[mm]; }
  part frontRightRim : Rim { :>> centerX=1350[mm]; :>> centerY=-895[mm]; }
  part frontRightHalfshaft : Halfshaft { :>> centerX=1350[mm]; :>> centerY=-470[mm]; }
  part frontRightArm : Arm { :>> centerX=1350[mm]; :>> centerY=-540[mm]; }
  part frontRightStrut : Strut { :>> centerX=1350[mm]; :>> centerY=-650[mm]; }
  part frontRightSpring : Spring { :>> centerX=1350[mm]; :>> centerY=-650[mm]; }
  part rearLeftTire : Tire { :>> centerX=-1350[mm]; :>> centerY=780[mm]; }
  part rearLeftRim : Rim { :>> centerX=-1350[mm]; :>> centerY=895[mm]; }
  part rearLeftHalfshaft : Halfshaft { :>> centerX=-1350[mm]; :>> centerY=470[mm]; }
  part rearLeftArm : Arm { :>> centerX=-1350[mm]; :>> centerY=540[mm]; }
  part rearLeftStrut : Strut { :>> centerX=-1350[mm]; :>> centerY=650[mm]; }
  part rearLeftSpring : Spring { :>> centerX=-1350[mm]; :>> centerY=650[mm]; }
  part rearRightTire : Tire { :>> centerX=-1350[mm]; :>> centerY=-780[mm]; }
  part rearRightRim : Rim { :>> centerX=-1350[mm]; :>> centerY=-895[mm]; }
  part rearRightHalfshaft : Halfshaft { :>> centerX=-1350[mm]; :>> centerY=-470[mm]; }
  part rearRightArm : Arm { :>> centerX=-1350[mm]; :>> centerY=-540[mm]; }
  part rearRightStrut : Strut { :>> centerX=-1350[mm]; :>> centerY=-650[mm]; }
  part rearRightSpring : Spring { :>> centerX=-1350[mm]; :>> centerY=-650[mm]; }
  part bodyLeft { attribute shape : String="loft"; attribute color : String="#426F95";
   part section0 : B0 { :>> centerY=625[mm]; } part section1 : B1 { :>> centerY=765[mm]; }
   part section2 : B2 { :>> centerY=835[mm]; } part section3 : B3 { :>> centerY=855[mm]; }
   part section4 : B4 { :>> centerY=860[mm]; } part section5 : B5 { :>> centerY=860[mm]; }
   part section6 : B6 { :>> centerY=865[mm]; } part section7 : B7 { :>> centerY=875[mm]; }
   part section8 : B8 { :>> centerY=875[mm]; } part section9 : B9 { :>> centerY=865[mm]; }
   part section10 : B10 { :>> centerY=855[mm]; } part section11 : B11 { :>> centerY=850[mm]; }
   part section12 : B12 { :>> centerY=845[mm]; } part section13 : B13 { :>> centerY=825[mm]; }
   part section14 : B14 { :>> centerY=800[mm]; } part section15 : B15 { :>> centerY=715[mm]; }
   part section16 : B16 { :>> centerY=625[mm]; }
  }
  part bodyRight { attribute shape : String="loft"; attribute color : String="#426F95";
   part section0 : B0 { :>> centerY=-625[mm]; } part section1 : B1 { :>> centerY=-765[mm]; }
   part section2 : B2 { :>> centerY=-835[mm]; } part section3 : B3 { :>> centerY=-855[mm]; }
   part section4 : B4 { :>> centerY=-860[mm]; } part section5 : B5 { :>> centerY=-860[mm]; }
   part section6 : B6 { :>> centerY=-865[mm]; } part section7 : B7 { :>> centerY=-875[mm]; }
   part section8 : B8 { :>> centerY=-875[mm]; } part section9 : B9 { :>> centerY=-865[mm]; }
   part section10 : B10 { :>> centerY=-855[mm]; } part section11 : B11 { :>> centerY=-850[mm]; }
   part section12 : B12 { :>> centerY=-845[mm]; } part section13 : B13 { :>> centerY=-825[mm]; }
   part section14 : B14 { :>> centerY=-800[mm]; } part section15 : B15 { :>> centerY=-715[mm]; }
   part section16 : B16 { :>> centerY=-625[mm]; }
  }
  part shoulderLeft { attribute shape : String="loft"; attribute color : String="#527EA1";
   part section0 : ShoulderSection { :>> centerX=-2300[mm]; :>> centerY=595[mm]; :>> centerZ=640[mm]; }
   part section1 : ShoulderSection { :>> centerX=-2100[mm]; :>> centerY=735[mm]; :>> centerZ=750[mm]; }
   part section2 : ShoulderSection { :>> centerX=-1750[mm]; :>> centerY=805[mm]; :>> centerZ=840[mm]; }
   part section3 : ShoulderSection { :>> centerX=-1500[mm]; :>> centerY=825[mm]; :>> centerZ=880[mm]; }
   part section4 : ShoulderSection { :>> centerX=-1350[mm]; :>> centerY=830[mm]; :>> centerZ=890[mm]; }
   part section5 : ShoulderSection { :>> centerX=-1150[mm]; :>> centerY=830[mm]; :>> centerZ=910[mm]; }
   part section6 : ShoulderSection { :>> centerX=-900[mm]; :>> centerY=835[mm]; :>> centerZ=930[mm]; }
   part section7 : ShoulderSection { :>> centerX=-500[mm]; :>> centerY=845[mm]; :>> centerZ=950[mm]; }
   part section8 : ShoulderSection { :>> centerX=0[mm]; :>> centerY=845[mm]; :>> centerZ=960[mm]; }
   part section9 : ShoulderSection { :>> centerX=500[mm]; :>> centerY=835[mm]; :>> centerZ=950[mm]; }
   part section10 : ShoulderSection { :>> centerX=900[mm]; :>> centerY=825[mm]; :>> centerZ=930[mm]; }
   part section11 : ShoulderSection { :>> centerX=1150[mm]; :>> centerY=820[mm]; :>> centerZ=905[mm]; }
   part section12 : ShoulderSection { :>> centerX=1350[mm]; :>> centerY=815[mm]; :>> centerZ=890[mm]; }
   part section13 : ShoulderSection { :>> centerX=1550[mm]; :>> centerY=795[mm]; :>> centerZ=860[mm]; }
   part section14 : ShoulderSection { :>> centerX=1750[mm]; :>> centerY=770[mm]; :>> centerZ=820[mm]; }
   part section15 : ShoulderSection { :>> centerX=2100[mm]; :>> centerY=685[mm]; :>> centerZ=710[mm]; }
   part section16 : ShoulderSection { :>> centerX=2300[mm]; :>> centerY=595[mm]; :>> centerZ=640[mm]; }
  }
  part shoulderRight { attribute shape : String="loft"; attribute color : String="#527EA1";
   part section0 : ShoulderSection { :>> centerX=-2300[mm]; :>> centerY=-595[mm]; :>> centerZ=640[mm]; }
   part section1 : ShoulderSection { :>> centerX=-2100[mm]; :>> centerY=-735[mm]; :>> centerZ=750[mm]; }
   part section2 : ShoulderSection { :>> centerX=-1750[mm]; :>> centerY=-805[mm]; :>> centerZ=840[mm]; }
   part section3 : ShoulderSection { :>> centerX=-1500[mm]; :>> centerY=-825[mm]; :>> centerZ=880[mm]; }
   part section4 : ShoulderSection { :>> centerX=-1350[mm]; :>> centerY=-830[mm]; :>> centerZ=890[mm]; }
   part section5 : ShoulderSection { :>> centerX=-1150[mm]; :>> centerY=-830[mm]; :>> centerZ=910[mm]; }
   part section6 : ShoulderSection { :>> centerX=-900[mm]; :>> centerY=-835[mm]; :>> centerZ=930[mm]; }
   part section7 : ShoulderSection { :>> centerX=-500[mm]; :>> centerY=-845[mm]; :>> centerZ=950[mm]; }
   part section8 : ShoulderSection { :>> centerX=0[mm]; :>> centerY=-845[mm]; :>> centerZ=960[mm]; }
   part section9 : ShoulderSection { :>> centerX=500[mm]; :>> centerY=-835[mm]; :>> centerZ=950[mm]; }
   part section10 : ShoulderSection { :>> centerX=900[mm]; :>> centerY=-825[mm]; :>> centerZ=930[mm]; }
   part section11 : ShoulderSection { :>> centerX=1150[mm]; :>> centerY=-820[mm]; :>> centerZ=905[mm]; }
   part section12 : ShoulderSection { :>> centerX=1350[mm]; :>> centerY=-815[mm]; :>> centerZ=890[mm]; }
   part section13 : ShoulderSection { :>> centerX=1550[mm]; :>> centerY=-795[mm]; :>> centerZ=860[mm]; }
   part section14 : ShoulderSection { :>> centerX=1750[mm]; :>> centerY=-770[mm]; :>> centerZ=820[mm]; }
   part section15 : ShoulderSection { :>> centerX=2100[mm]; :>> centerY=-685[mm]; :>> centerZ=710[mm]; }
   part section16 : ShoulderSection { :>> centerX=2300[mm]; :>> centerY=-595[mm]; :>> centerZ=640[mm]; }
  }
  part hoodLeft { attribute shape : String="loft"; attribute color : String="#426F95";
   part section0 : HoodSection { :>> centerX=900[mm]; :>> centerY=680[mm]; :>> centerZ=930[mm]; :>> width=220[mm]; }
   part section1 : HoodSection { :>> centerX=1350[mm]; :>> centerY=660[mm]; :>> centerZ=900[mm]; :>> width=220[mm]; }
   part section2 : HoodSection { :>> centerX=1750[mm]; :>> centerY=620[mm]; :>> centerZ=825[mm]; :>> width=220[mm]; }
   part section3 : HoodSection { :>> centerX=2100[mm]; :>> centerY=600[mm]; :>> centerZ=720[mm]; :>> width=140[mm]; }
  }
  part hoodRight { attribute shape : String="loft"; attribute color : String="#426F95";
   part section0 : HoodSection { :>> centerX=900[mm]; :>> centerY=-680[mm]; :>> centerZ=930[mm]; :>> width=220[mm]; }
   part section1 : HoodSection { :>> centerX=1350[mm]; :>> centerY=-660[mm]; :>> centerZ=900[mm]; :>> width=220[mm]; }
   part section2 : HoodSection { :>> centerX=1750[mm]; :>> centerY=-620[mm]; :>> centerZ=825[mm]; :>> width=220[mm]; }
   part section3 : HoodSection { :>> centerX=2100[mm]; :>> centerY=-600[mm]; :>> centerZ=720[mm]; :>> width=140[mm]; }
  }
  part deckLeft { attribute shape : String="loft"; attribute color : String="#426F95";
   part section0 : HoodSection { :>> centerX=-2100[mm]; :>> centerY=600[mm]; :>> centerZ=760[mm]; :>> width=140[mm]; }
   part section1 : HoodSection { :>> centerX=-1750[mm]; :>> centerY=640[mm]; :>> centerZ=850[mm]; :>> width=220[mm]; }
   part section2 : HoodSection { :>> centerX=-1450[mm]; :>> centerY=680[mm]; :>> centerZ=900[mm]; :>> width=220[mm]; }
  }
  part deckRight { attribute shape : String="loft"; attribute color : String="#426F95";
   part section0 : HoodSection { :>> centerX=-2100[mm]; :>> centerY=-600[mm]; :>> centerZ=760[mm]; :>> width=140[mm]; }
   part section1 : HoodSection { :>> centerX=-1750[mm]; :>> centerY=-640[mm]; :>> centerZ=850[mm]; :>> width=220[mm]; }
   part section2 : HoodSection { :>> centerX=-1450[mm]; :>> centerY=-680[mm]; :>> centerZ=900[mm]; :>> width=220[mm]; }
  }
  part glassLeft { attribute shape : String="loft"; attribute color : String="#447884";
   part section0 : Section { :>> centerX=-1400[mm]; :>> centerY=715[mm]; :>> centerZ=940[mm]; :>> width=90[mm]; :>> height=80[mm]; }
   part section1 : Section { :>> centerX=-1000[mm]; :>> centerY=690[mm]; :>> centerZ=1090[mm]; :>> width=70[mm]; :>> height=240[mm]; }
   part section2 : Section { :>> centerX=-600[mm]; :>> centerY=650[mm]; :>> centerZ=1200[mm]; :>> width=55[mm]; :>> height=390[mm]; }
   part section3 : Section { :>> centerX=0[mm]; :>> centerY=650[mm]; :>> centerZ=1230[mm]; :>> width=55[mm]; :>> height=420[mm]; }
   part section4 : Section { :>> centerX=550[mm]; :>> centerY=690[mm]; :>> centerZ=1160[mm]; :>> width=65[mm]; :>> height=300[mm]; }
   part section5 : Section { :>> centerX=900[mm]; :>> centerY=725[mm]; :>> centerZ=990[mm]; :>> width=80[mm]; :>> height=100[mm]; }
  }
  part glassRight { attribute shape : String="loft"; attribute color : String="#447884";
   part section0 : Section { :>> centerX=-1400[mm]; :>> centerY=-715[mm]; :>> centerZ=940[mm]; :>> width=90[mm]; :>> height=80[mm]; }
   part section1 : Section { :>> centerX=-1000[mm]; :>> centerY=-690[mm]; :>> centerZ=1090[mm]; :>> width=70[mm]; :>> height=240[mm]; }
   part section2 : Section { :>> centerX=-600[mm]; :>> centerY=-650[mm]; :>> centerZ=1200[mm]; :>> width=55[mm]; :>> height=390[mm]; }
   part section3 : Section { :>> centerX=0[mm]; :>> centerY=-650[mm]; :>> centerZ=1230[mm]; :>> width=55[mm]; :>> height=420[mm]; }
   part section4 : Section { :>> centerX=550[mm]; :>> centerY=-690[mm]; :>> centerZ=1160[mm]; :>> width=65[mm]; :>> height=300[mm]; }
   part section5 : Section { :>> centerX=900[mm]; :>> centerY=-725[mm]; :>> centerZ=990[mm]; :>> width=80[mm]; :>> height=100[mm]; }
  }
  part sillLeft { attribute shape : String="loft"; attribute color : String="#A5B7C5";
   part section0 : WaistSection { :>> centerX=-950[mm]; :>> centerY=875[mm]; :>> centerZ=360[mm]; }
   part section1 : WaistSection { :>> centerX=850[mm]; :>> centerY=865[mm]; :>> centerZ=360[mm]; }
  }
  part sillRight { attribute shape : String="loft"; attribute color : String="#A5B7C5";
   part section0 : WaistSection { :>> centerX=-950[mm]; :>> centerY=-875[mm]; :>> centerZ=360[mm]; }
   part section1 : WaistSection { :>> centerX=850[mm]; :>> centerY=-865[mm]; :>> centerZ=360[mm]; }
  }
  part waistLeft { attribute shape : String="loft"; attribute color : String="#A5B7C5";
   part section0 : WaistSection { :>> centerX=-2100[mm]; :>> centerY=790[mm]; :>> centerZ=780[mm]; }
   part section1 : WaistSection { :>> centerX=-1000[mm]; :>> centerY=890[mm]; :>> centerZ=945[mm]; }
   part section2 : WaistSection { :>> centerX=0[mm]; :>> centerY=900[mm]; :>> centerZ=975[mm]; }
   part section3 : WaistSection { :>> centerX=900[mm]; :>> centerY=880[mm]; :>> centerZ=945[mm]; }
   part section4 : WaistSection { :>> centerX=2100[mm]; :>> centerY=740[mm]; :>> centerZ=740[mm]; }
  }
  part waistRight { attribute shape : String="loft"; attribute color : String="#A5B7C5";
   part section0 : WaistSection { :>> centerX=-2100[mm]; :>> centerY=-790[mm]; :>> centerZ=780[mm]; }
   part section1 : WaistSection { :>> centerX=-1000[mm]; :>> centerY=-890[mm]; :>> centerZ=945[mm]; }
   part section2 : WaistSection { :>> centerX=0[mm]; :>> centerY=-900[mm]; :>> centerZ=975[mm]; }
   part section3 : WaistSection { :>> centerX=900[mm]; :>> centerY=-880[mm]; :>> centerZ=945[mm]; }
   part section4 : WaistSection { :>> centerX=2100[mm]; :>> centerY=-740[mm]; :>> centerZ=740[mm]; }
  }
  part roofRailLeft { attribute shape : String="loft"; attribute color : String="#A5B7C5";
   part section0 : RailSection { :>> centerX=-1450[mm]; :>> centerY=720[mm]; :>> centerZ=980[mm]; }
   part section1 : RailSection { :>> centerX=-1000[mm]; :>> centerY=690[mm]; :>> centerZ=1270[mm]; }
   part section2 : RailSection { :>> centerX=-600[mm]; :>> centerY=650[mm]; :>> centerZ=1420[mm]; }
   part section3 : RailSection { :>> centerX=0[mm]; :>> centerY=650[mm]; :>> centerZ=1450[mm]; }
   part section4 : RailSection { :>> centerX=500[mm]; :>> centerY=680[mm]; :>> centerZ=1350[mm]; }
   part section5 : RailSection { :>> centerX=950[mm]; :>> centerY=750[mm]; :>> centerZ=1030[mm]; }
  }
  part roofRailRight { attribute shape : String="loft"; attribute color : String="#A5B7C5";
   part section0 : RailSection { :>> centerX=-1450[mm]; :>> centerY=-720[mm]; :>> centerZ=980[mm]; }
   part section1 : RailSection { :>> centerX=-1000[mm]; :>> centerY=-690[mm]; :>> centerZ=1270[mm]; }
   part section2 : RailSection { :>> centerX=-600[mm]; :>> centerY=-650[mm]; :>> centerZ=1420[mm]; }
   part section3 : RailSection { :>> centerX=0[mm]; :>> centerY=-650[mm]; :>> centerZ=1450[mm]; }
   part section4 : RailSection { :>> centerX=500[mm]; :>> centerY=-680[mm]; :>> centerZ=1350[mm]; }
   part section5 : RailSection { :>> centerX=950[mm]; :>> centerY=-750[mm]; :>> centerZ=1030[mm]; }
  }
  part headlightLeft : Box { :>> length=95[mm]; :>> width=220[mm]; :>> height=65[mm]; :>> centerX=2200[mm]; :>> centerY=630[mm]; :>> centerZ=640[mm]; :>> color="#E8EFE5"; }
  part headlightRight : Box { :>> length=95[mm]; :>> width=220[mm]; :>> height=65[mm]; :>> centerX=2200[mm]; :>> centerY=-630[mm]; :>> centerZ=640[mm]; :>> color="#E8EFE5"; }
  part taillightLeft : Box { :>> length=80[mm]; :>> width=230[mm]; :>> height=65[mm]; :>> centerX=-2210[mm]; :>> centerY=620[mm]; :>> centerZ=660[mm]; :>> color="#B5433F"; }
  part taillightRight : Box { :>> length=80[mm]; :>> width=230[mm]; :>> height=65[mm]; :>> centerX=-2210[mm]; :>> centerY=-620[mm]; :>> centerZ=660[mm]; :>> color="#B5433F"; }
  part mirrorStemLeft : Box { :>> length=60[mm]; :>> width=160[mm]; :>> height=25[mm]; :>> centerX=650[mm]; :>> centerY=910[mm]; :>> centerZ=1040[mm]; :>> color="#A5B7C5"; }
  part mirrorStemRight : Box { :>> length=60[mm]; :>> width=160[mm]; :>> height=25[mm]; :>> centerX=650[mm]; :>> centerY=-910[mm]; :>> centerZ=1040[mm]; :>> color="#A5B7C5"; }
  part mirrorLeft : Box { :>> length=150[mm]; :>> width=100[mm]; :>> height=85[mm]; :>> centerX=650[mm]; :>> centerY=1040[mm]; :>> centerZ=1070[mm]; :>> color="#426F95"; }
  part mirrorRight : Box { :>> length=150[mm]; :>> width=100[mm]; :>> height=85[mm]; :>> centerX=650[mm]; :>> centerY=-1040[mm]; :>> centerZ=1070[mm]; :>> color="#426F95"; }
  part frontValance : Box { :>> length=50[mm]; :>> width=1200[mm]; :>> height=150[mm]; :>> centerX=2270[mm]; :>> centerY=0[mm]; :>> centerZ=510[mm]; :>> color="#426F95"; }
  part rearValance : Box { :>> length=50[mm]; :>> width=1200[mm]; :>> height=150[mm]; :>> centerX=-2270[mm]; :>> centerY=0[mm]; :>> centerZ=510[mm]; :>> color="#426F95"; }
 }
}
