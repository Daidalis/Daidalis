package SedanAppearance {
  private import ScalarValues::*;
  private import ISQ::*;
  private import SI::*;
  part vehicle {
    doc /* Same solids as Sedan.scad; mm, +X forward, +Z up. Open cabin, wheel arches and central hood. */
    part floor {
      attribute shape : String = "box";
      attribute color : String = "#596675";
      attribute centerX : LengthValue = 0 [mm];
      attribute centerY : LengthValue = 0 [mm];
      attribute centerZ : LengthValue = 240 [mm];
      attribute length : LengthValue = 2660 [mm];
      attribute width : LengthValue = 1310 [mm];
      attribute height : LengthValue = 65 [mm];
    }
    part battery {
      attribute shape : String = "box";
      attribute color : String = "#D89035";
      attribute centerX : LengthValue = 0 [mm];
      attribute centerY : LengthValue = 0 [mm];
      attribute centerZ : LengthValue = 350 [mm];
      attribute length : LengthValue = 2200 [mm];
      attribute width : LengthValue = 1200 [mm];
      attribute height : LengthValue = 140 [mm];
    }
    part inverter {
      attribute shape : String = "box";
      attribute color : String = "#7C9BAD";
      attribute centerX : LengthValue = 1550 [mm];
      attribute centerY : LengthValue = 0 [mm];
      attribute centerZ : LengthValue = 780 [mm];
      attribute length : LengthValue = 450 [mm];
      attribute width : LengthValue = 520 [mm];
      attribute height : LengthValue = 150 [mm];
    }
    part motor {
      attribute shape : String = "cylinder";
      attribute color : String = "#B18B55";
      attribute centerX : LengthValue = 1470 [mm];
      attribute centerY : LengthValue = 0 [mm];
      attribute centerZ : LengthValue = 510 [mm];
      attribute radius : LengthValue = 170 [mm];
      attribute height : LengthValue = 600 [mm];
      attribute axis : String = "Y";
    }
    part frontSubframe {
      attribute shape : String = "box";
      attribute color : String = "#596675";
      attribute centerX : LengthValue = 1400 [mm];
      attribute centerY : LengthValue = 0 [mm];
      attribute centerZ : LengthValue = 265 [mm];
      attribute length : LengthValue = 480 [mm];
      attribute width : LengthValue = 1250 [mm];
      attribute height : LengthValue = 90 [mm];
    }
    part frontLeftTire {
      attribute shape : String = "cylinder";
      attribute color : String = "#242830";
      attribute centerX : LengthValue = 1400 [mm];
      attribute centerY : LengthValue = 825 [mm];
      attribute centerZ : LengthValue = 330 [mm];
      attribute radius : LengthValue = 330 [mm];
      attribute height : LengthValue = 220 [mm];
      attribute axis : String = "Y";
    }
    part frontLeftRim {
      attribute shape : String = "cylinder";
      attribute color : String = "#CDD5DC";
      attribute centerX : LengthValue = 1400 [mm];
      attribute centerY : LengthValue = 940 [mm];
      attribute centerZ : LengthValue = 330 [mm];
      attribute radius : LengthValue = 218 [mm];
      attribute height : LengthValue = 18 [mm];
      attribute axis : String = "Y";
    }
    part frontLeftHub {
      attribute shape : String = "cylinder";
      attribute color : String = "#596675";
      attribute centerX : LengthValue = 1400 [mm];
      attribute centerY : LengthValue = 957 [mm];
      attribute centerZ : LengthValue = 330 [mm];
      attribute radius : LengthValue = 65 [mm];
      attribute height : LengthValue = 20 [mm];
      attribute axis : String = "Y";
    }
    part frontLeftLowerArm {
      attribute shape : String = "box";
      attribute color : String = "#596675";
      attribute centerX : LengthValue = 1400 [mm];
      attribute centerY : LengthValue = 650 [mm];
      attribute centerZ : LengthValue = 290 [mm];
      attribute length : LengthValue = 210 [mm];
      attribute width : LengthValue = 280 [mm];
      attribute height : LengthValue = 38 [mm];
    }
    part frontLeftUpperArm {
      attribute shape : String = "box";
      attribute color : String = "#596675";
      attribute centerX : LengthValue = 1400 [mm];
      attribute centerY : LengthValue = 660 [mm];
      attribute centerZ : LengthValue = 480 [mm];
      attribute length : LengthValue = 170 [mm];
      attribute width : LengthValue = 250 [mm];
      attribute height : LengthValue = 30 [mm];
    }
    part frontLeftStrut {
      attribute shape : String = "cylinder";
      attribute color : String = "#B6C2CB";
      attribute centerX : LengthValue = 1400 [mm];
      attribute centerY : LengthValue = 690 [mm];
      attribute centerZ : LengthValue = 550 [mm];
      attribute radius : LengthValue = 34 [mm];
      attribute height : LengthValue = 350 [mm];
      attribute axis : String = "Z";
    }
    part frontLeftHalfshaft {
      attribute shape : String = "cylinder";
      attribute color : String = "#8B96A0";
      attribute centerX : LengthValue = 1400 [mm];
      attribute centerY : LengthValue = 515 [mm];
      attribute centerZ : LengthValue = 365 [mm];
      attribute radius : LengthValue = 28 [mm];
      attribute height : LengthValue = 440 [mm];
      attribute axis : String = "Y";
    }
    part frontRightTire {
      attribute shape : String = "cylinder";
      attribute color : String = "#242830";
      attribute centerX : LengthValue = 1400 [mm];
      attribute centerY : LengthValue = -825 [mm];
      attribute centerZ : LengthValue = 330 [mm];
      attribute radius : LengthValue = 330 [mm];
      attribute height : LengthValue = 220 [mm];
      attribute axis : String = "Y";
    }
    part frontRightRim {
      attribute shape : String = "cylinder";
      attribute color : String = "#CDD5DC";
      attribute centerX : LengthValue = 1400 [mm];
      attribute centerY : LengthValue = -940 [mm];
      attribute centerZ : LengthValue = 330 [mm];
      attribute radius : LengthValue = 218 [mm];
      attribute height : LengthValue = 18 [mm];
      attribute axis : String = "Y";
    }
    part frontRightHub {
      attribute shape : String = "cylinder";
      attribute color : String = "#596675";
      attribute centerX : LengthValue = 1400 [mm];
      attribute centerY : LengthValue = -957 [mm];
      attribute centerZ : LengthValue = 330 [mm];
      attribute radius : LengthValue = 65 [mm];
      attribute height : LengthValue = 20 [mm];
      attribute axis : String = "Y";
    }
    part frontRightLowerArm {
      attribute shape : String = "box";
      attribute color : String = "#596675";
      attribute centerX : LengthValue = 1400 [mm];
      attribute centerY : LengthValue = -650 [mm];
      attribute centerZ : LengthValue = 290 [mm];
      attribute length : LengthValue = 210 [mm];
      attribute width : LengthValue = 280 [mm];
      attribute height : LengthValue = 38 [mm];
    }
    part frontRightUpperArm {
      attribute shape : String = "box";
      attribute color : String = "#596675";
      attribute centerX : LengthValue = 1400 [mm];
      attribute centerY : LengthValue = -660 [mm];
      attribute centerZ : LengthValue = 480 [mm];
      attribute length : LengthValue = 170 [mm];
      attribute width : LengthValue = 250 [mm];
      attribute height : LengthValue = 30 [mm];
    }
    part frontRightStrut {
      attribute shape : String = "cylinder";
      attribute color : String = "#B6C2CB";
      attribute centerX : LengthValue = 1400 [mm];
      attribute centerY : LengthValue = -690 [mm];
      attribute centerZ : LengthValue = 550 [mm];
      attribute radius : LengthValue = 34 [mm];
      attribute height : LengthValue = 350 [mm];
      attribute axis : String = "Z";
    }
    part frontRightHalfshaft {
      attribute shape : String = "cylinder";
      attribute color : String = "#8B96A0";
      attribute centerX : LengthValue = 1400 [mm];
      attribute centerY : LengthValue = -515 [mm];
      attribute centerZ : LengthValue = 365 [mm];
      attribute radius : LengthValue = 28 [mm];
      attribute height : LengthValue = 440 [mm];
      attribute axis : String = "Y";
    }
    part rearSubframe {
      attribute shape : String = "box";
      attribute color : String = "#596675";
      attribute centerX : LengthValue = -1400 [mm];
      attribute centerY : LengthValue = 0 [mm];
      attribute centerZ : LengthValue = 265 [mm];
      attribute length : LengthValue = 480 [mm];
      attribute width : LengthValue = 1250 [mm];
      attribute height : LengthValue = 90 [mm];
    }
    part rearLeftTire {
      attribute shape : String = "cylinder";
      attribute color : String = "#242830";
      attribute centerX : LengthValue = -1400 [mm];
      attribute centerY : LengthValue = 825 [mm];
      attribute centerZ : LengthValue = 330 [mm];
      attribute radius : LengthValue = 330 [mm];
      attribute height : LengthValue = 220 [mm];
      attribute axis : String = "Y";
    }
    part rearLeftRim {
      attribute shape : String = "cylinder";
      attribute color : String = "#CDD5DC";
      attribute centerX : LengthValue = -1400 [mm];
      attribute centerY : LengthValue = 940 [mm];
      attribute centerZ : LengthValue = 330 [mm];
      attribute radius : LengthValue = 218 [mm];
      attribute height : LengthValue = 18 [mm];
      attribute axis : String = "Y";
    }
    part rearLeftHub {
      attribute shape : String = "cylinder";
      attribute color : String = "#596675";
      attribute centerX : LengthValue = -1400 [mm];
      attribute centerY : LengthValue = 957 [mm];
      attribute centerZ : LengthValue = 330 [mm];
      attribute radius : LengthValue = 65 [mm];
      attribute height : LengthValue = 20 [mm];
      attribute axis : String = "Y";
    }
    part rearLeftLowerArm {
      attribute shape : String = "box";
      attribute color : String = "#596675";
      attribute centerX : LengthValue = -1400 [mm];
      attribute centerY : LengthValue = 650 [mm];
      attribute centerZ : LengthValue = 290 [mm];
      attribute length : LengthValue = 210 [mm];
      attribute width : LengthValue = 280 [mm];
      attribute height : LengthValue = 38 [mm];
    }
    part rearLeftUpperArm {
      attribute shape : String = "box";
      attribute color : String = "#596675";
      attribute centerX : LengthValue = -1400 [mm];
      attribute centerY : LengthValue = 660 [mm];
      attribute centerZ : LengthValue = 480 [mm];
      attribute length : LengthValue = 170 [mm];
      attribute width : LengthValue = 250 [mm];
      attribute height : LengthValue = 30 [mm];
    }
    part rearLeftStrut {
      attribute shape : String = "cylinder";
      attribute color : String = "#B6C2CB";
      attribute centerX : LengthValue = -1400 [mm];
      attribute centerY : LengthValue = 690 [mm];
      attribute centerZ : LengthValue = 550 [mm];
      attribute radius : LengthValue = 34 [mm];
      attribute height : LengthValue = 350 [mm];
      attribute axis : String = "Z";
    }
    part rearLeftHalfshaft {
      attribute shape : String = "cylinder";
      attribute color : String = "#8B96A0";
      attribute centerX : LengthValue = -1400 [mm];
      attribute centerY : LengthValue = 515 [mm];
      attribute centerZ : LengthValue = 365 [mm];
      attribute radius : LengthValue = 28 [mm];
      attribute height : LengthValue = 440 [mm];
      attribute axis : String = "Y";
    }
    part rearRightTire {
      attribute shape : String = "cylinder";
      attribute color : String = "#242830";
      attribute centerX : LengthValue = -1400 [mm];
      attribute centerY : LengthValue = -825 [mm];
      attribute centerZ : LengthValue = 330 [mm];
      attribute radius : LengthValue = 330 [mm];
      attribute height : LengthValue = 220 [mm];
      attribute axis : String = "Y";
    }
    part rearRightRim {
      attribute shape : String = "cylinder";
      attribute color : String = "#CDD5DC";
      attribute centerX : LengthValue = -1400 [mm];
      attribute centerY : LengthValue = -940 [mm];
      attribute centerZ : LengthValue = 330 [mm];
      attribute radius : LengthValue = 218 [mm];
      attribute height : LengthValue = 18 [mm];
      attribute axis : String = "Y";
    }
    part rearRightHub {
      attribute shape : String = "cylinder";
      attribute color : String = "#596675";
      attribute centerX : LengthValue = -1400 [mm];
      attribute centerY : LengthValue = -957 [mm];
      attribute centerZ : LengthValue = 330 [mm];
      attribute radius : LengthValue = 65 [mm];
      attribute height : LengthValue = 20 [mm];
      attribute axis : String = "Y";
    }
    part rearRightLowerArm {
      attribute shape : String = "box";
      attribute color : String = "#596675";
      attribute centerX : LengthValue = -1400 [mm];
      attribute centerY : LengthValue = -650 [mm];
      attribute centerZ : LengthValue = 290 [mm];
      attribute length : LengthValue = 210 [mm];
      attribute width : LengthValue = 280 [mm];
      attribute height : LengthValue = 38 [mm];
    }
    part rearRightUpperArm {
      attribute shape : String = "box";
      attribute color : String = "#596675";
      attribute centerX : LengthValue = -1400 [mm];
      attribute centerY : LengthValue = -660 [mm];
      attribute centerZ : LengthValue = 480 [mm];
      attribute length : LengthValue = 170 [mm];
      attribute width : LengthValue = 250 [mm];
      attribute height : LengthValue = 30 [mm];
    }
    part rearRightStrut {
      attribute shape : String = "cylinder";
      attribute color : String = "#B6C2CB";
      attribute centerX : LengthValue = -1400 [mm];
      attribute centerY : LengthValue = -690 [mm];
      attribute centerZ : LengthValue = 550 [mm];
      attribute radius : LengthValue = 34 [mm];
      attribute height : LengthValue = 350 [mm];
      attribute axis : String = "Z";
    }
    part rearRightHalfshaft {
      attribute shape : String = "cylinder";
      attribute color : String = "#8B96A0";
      attribute centerX : LengthValue = -1400 [mm];
      attribute centerY : LengthValue = -515 [mm];
      attribute centerZ : LengthValue = 365 [mm];
      attribute radius : LengthValue = 28 [mm];
      attribute height : LengthValue = 440 [mm];
      attribute axis : String = "Y";
    }
    part LeftSill {
      attribute shape : String = "box";
      attribute color : String = "#267BA0";
      attribute centerX : LengthValue = 0 [mm];
      attribute centerY : LengthValue = 830 [mm];
      attribute centerZ : LengthValue = 440 [mm];
      attribute length : LengthValue = 2020 [mm];
      attribute width : LengthValue = 90 [mm];
      attribute height : LengthValue = 170 [mm];
    }
    part frontLeftWheelBrow {
      attribute shape : String = "loft";
      attribute color : String = "#267BA0";
      attribute centerX : LengthValue = 0 [mm];
      attribute centerY : LengthValue = 0 [mm];
      attribute centerZ : LengthValue = 0 [mm];
      attribute section1X : LengthValue = 995 [mm];
      attribute section1Y : LengthValue = 865 [mm];
      attribute section1Z : LengthValue = 610 [mm];
      attribute section1Width : LengthValue = 55 [mm];
      attribute section1Height : LengthValue = 45 [mm];
      attribute section2X : LengthValue = 1100 [mm];
      attribute section2Y : LengthValue = 865 [mm];
      attribute section2Z : LengthValue = 735 [mm];
      attribute section2Width : LengthValue = 80 [mm];
      attribute section2Height : LengthValue = 45 [mm];
      attribute section3X : LengthValue = 1400 [mm];
      attribute section3Y : LengthValue = 865 [mm];
      attribute section3Z : LengthValue = 785 [mm];
      attribute section3Width : LengthValue = 90 [mm];
      attribute section3Height : LengthValue = 45 [mm];
      attribute section4X : LengthValue = 1700 [mm];
      attribute section4Y : LengthValue = 865 [mm];
      attribute section4Z : LengthValue = 735 [mm];
      attribute section4Width : LengthValue = 80 [mm];
      attribute section4Height : LengthValue = 45 [mm];
      attribute section5X : LengthValue = 1805 [mm];
      attribute section5Y : LengthValue = 865 [mm];
      attribute section5Z : LengthValue = 610 [mm];
      attribute section5Width : LengthValue = 55 [mm];
      attribute section5Height : LengthValue = 45 [mm];
    }
    part rearLeftWheelBrow {
      attribute shape : String = "loft";
      attribute color : String = "#267BA0";
      attribute centerX : LengthValue = 0 [mm];
      attribute centerY : LengthValue = 0 [mm];
      attribute centerZ : LengthValue = 0 [mm];
      attribute section1X : LengthValue = -1805 [mm];
      attribute section1Y : LengthValue = 865 [mm];
      attribute section1Z : LengthValue = 610 [mm];
      attribute section1Width : LengthValue = 55 [mm];
      attribute section1Height : LengthValue = 45 [mm];
      attribute section2X : LengthValue = -1700 [mm];
      attribute section2Y : LengthValue = 865 [mm];
      attribute section2Z : LengthValue = 735 [mm];
      attribute section2Width : LengthValue = 80 [mm];
      attribute section2Height : LengthValue = 45 [mm];
      attribute section3X : LengthValue = -1400 [mm];
      attribute section3Y : LengthValue = 865 [mm];
      attribute section3Z : LengthValue = 785 [mm];
      attribute section3Width : LengthValue = 90 [mm];
      attribute section3Height : LengthValue = 45 [mm];
      attribute section4X : LengthValue = -1100 [mm];
      attribute section4Y : LengthValue = 865 [mm];
      attribute section4Z : LengthValue = 735 [mm];
      attribute section4Width : LengthValue = 80 [mm];
      attribute section4Height : LengthValue = 45 [mm];
      attribute section5X : LengthValue = -995 [mm];
      attribute section5Y : LengthValue = 865 [mm];
      attribute section5Z : LengthValue = 610 [mm];
      attribute section5Width : LengthValue = 55 [mm];
      attribute section5Height : LengthValue = 45 [mm];
    }
    part LeftWaist {
      attribute shape : String = "loft";
      attribute color : String = "#267BA0";
      attribute centerX : LengthValue = 0 [mm];
      attribute centerY : LengthValue = 0 [mm];
      attribute centerZ : LengthValue = 0 [mm];
      attribute section1X : LengthValue = -2220 [mm];
      attribute section1Y : LengthValue = 820 [mm];
      attribute section1Z : LengthValue = 735 [mm];
      attribute section1Width : LengthValue = 70 [mm];
      attribute section1Height : LengthValue = 70 [mm];
      attribute section2X : LengthValue = -1850 [mm];
      attribute section2Y : LengthValue = 860 [mm];
      attribute section2Z : LengthValue = 835 [mm];
      attribute section2Width : LengthValue = 70 [mm];
      attribute section2Height : LengthValue = 80 [mm];
      attribute section3X : LengthValue = -900 [mm];
      attribute section3Y : LengthValue = 875 [mm];
      attribute section3Z : LengthValue = 865 [mm];
      attribute section3Width : LengthValue = 70 [mm];
      attribute section3Height : LengthValue = 80 [mm];
      attribute section4X : LengthValue = 400 [mm];
      attribute section4Y : LengthValue = 870 [mm];
      attribute section4Z : LengthValue = 890 [mm];
      attribute section4Width : LengthValue = 70 [mm];
      attribute section4Height : LengthValue = 80 [mm];
      attribute section5X : LengthValue = 1150 [mm];
      attribute section5Y : LengthValue = 850 [mm];
      attribute section5Z : LengthValue = 850 [mm];
      attribute section5Width : LengthValue = 70 [mm];
      attribute section5Height : LengthValue = 75 [mm];
      attribute section6X : LengthValue = 2200 [mm];
      attribute section6Y : LengthValue = 760 [mm];
      attribute section6Z : LengthValue = 710 [mm];
      attribute section6Width : LengthValue = 65 [mm];
      attribute section6Height : LengthValue = 65 [mm];
    }
    part LeftRoofRail {
      attribute shape : String = "loft";
      attribute color : String = "#267BA0";
      attribute centerX : LengthValue = 0 [mm];
      attribute centerY : LengthValue = 0 [mm];
      attribute centerZ : LengthValue = 0 [mm];
      attribute section1X : LengthValue = -1150 [mm];
      attribute section1Y : LengthValue = 690 [mm];
      attribute section1Z : LengthValue = 1000 [mm];
      attribute section1Width : LengthValue = 65 [mm];
      attribute section1Height : LengthValue = 65 [mm];
      attribute section2X : LengthValue = -650 [mm];
      attribute section2Y : LengthValue = 665 [mm];
      attribute section2Z : LengthValue = 1360 [mm];
      attribute section2Width : LengthValue = 65 [mm];
      attribute section2Height : LengthValue = 65 [mm];
      attribute section3X : LengthValue = -250 [mm];
      attribute section3Y : LengthValue = 655 [mm];
      attribute section3Z : LengthValue = 1450 [mm];
      attribute section3Width : LengthValue = 65 [mm];
      attribute section3Height : LengthValue = 65 [mm];
      attribute section4X : LengthValue = 300 [mm];
      attribute section4Y : LengthValue = 655 [mm];
      attribute section4Z : LengthValue = 1465 [mm];
      attribute section4Width : LengthValue = 65 [mm];
      attribute section4Height : LengthValue = 65 [mm];
      attribute section5X : LengthValue = 650 [mm];
      attribute section5Y : LengthValue = 665 [mm];
      attribute section5Z : LengthValue = 1405 [mm];
      attribute section5Width : LengthValue = 65 [mm];
      attribute section5Height : LengthValue = 65 [mm];
      attribute section6X : LengthValue = 1050 [mm];
      attribute section6Y : LengthValue = 740 [mm];
      attribute section6Z : LengthValue = 1000 [mm];
      attribute section6Width : LengthValue = 65 [mm];
      attribute section6Height : LengthValue = 65 [mm];
    }
    part LeftGlass {
      attribute shape : String = "loft";
      attribute color : String = "#29434F";
      attribute centerX : LengthValue = 0 [mm];
      attribute centerY : LengthValue = 0 [mm];
      attribute centerZ : LengthValue = 0 [mm];
      attribute section1X : LengthValue = -1000 [mm];
      attribute section1Y : LengthValue = 720 [mm];
      attribute section1Z : LengthValue = 1040 [mm];
      attribute section1Width : LengthValue = 40 [mm];
      attribute section1Height : LengthValue = 160 [mm];
      attribute section2X : LengthValue = -550 [mm];
      attribute section2Y : LengthValue = 700 [mm];
      attribute section2Z : LengthValue = 1270 [mm];
      attribute section2Width : LengthValue = 40 [mm];
      attribute section2Height : LengthValue = 220 [mm];
      attribute section3X : LengthValue = 450 [mm];
      attribute section3Y : LengthValue = 700 [mm];
      attribute section3Z : LengthValue = 1290 [mm];
      attribute section3Width : LengthValue = 40 [mm];
      attribute section3Height : LengthValue = 215 [mm];
      attribute section4X : LengthValue = 900 [mm];
      attribute section4Y : LengthValue = 750 [mm];
      attribute section4Z : LengthValue = 1050 [mm];
      attribute section4Width : LengthValue = 40 [mm];
      attribute section4Height : LengthValue = 160 [mm];
    }
    part LeftMirror {
      attribute shape : String = "box";
      attribute color : String = "#267BA0";
      attribute centerX : LengthValue = 850 [mm];
      attribute centerY : LengthValue = 1000 [mm];
      attribute centerZ : LengthValue = 1050 [mm];
      attribute length : LengthValue = 200 [mm];
      attribute width : LengthValue = 140 [mm];
      attribute height : LengthValue = 90 [mm];
    }
    part LeftMirrorStem {
      attribute shape : String = "box";
      attribute color : String = "#596675";
      attribute centerX : LengthValue = 850 [mm];
      attribute centerY : LengthValue = 890 [mm];
      attribute centerZ : LengthValue = 1030 [mm];
      attribute length : LengthValue = 65 [mm];
      attribute width : LengthValue = 90 [mm];
      attribute height : LengthValue = 30 [mm];
    }
    part LeftHood {
      attribute shape : String = "loft";
      attribute color : String = "#267BA0";
      attribute centerX : LengthValue = 0 [mm];
      attribute centerY : LengthValue = 0 [mm];
      attribute centerZ : LengthValue = 0 [mm];
      attribute section1X : LengthValue = 1120 [mm];
      attribute section1Y : LengthValue = 640 [mm];
      attribute section1Z : LengthValue = 890 [mm];
      attribute section1Width : LengthValue = 340 [mm];
      attribute section1Height : LengthValue = 45 [mm];
      attribute section2X : LengthValue = 1700 [mm];
      attribute section2Y : LengthValue = 630 [mm];
      attribute section2Z : LengthValue = 855 [mm];
      attribute section2Width : LengthValue = 340 [mm];
      attribute section2Height : LengthValue = 45 [mm];
      attribute section3X : LengthValue = 2200 [mm];
      attribute section3Y : LengthValue = 570 [mm];
      attribute section3Z : LengthValue = 770 [mm];
      attribute section3Width : LengthValue = 300 [mm];
      attribute section3Height : LengthValue = 45 [mm];
    }
    part LeftHeadlamp {
      attribute shape : String = "box";
      attribute color : String = "#E5EBDB";
      attribute centerX : LengthValue = 2245 [mm];
      attribute centerY : LengthValue = 565 [mm];
      attribute centerZ : LengthValue = 760 [mm];
      attribute length : LengthValue = 75 [mm];
      attribute width : LengthValue = 360 [mm];
      attribute height : LengthValue = 95 [mm];
    }
    part LeftTaillamp {
      attribute shape : String = "box";
      attribute color : String = "#A54857";
      attribute centerX : LengthValue = -2260 [mm];
      attribute centerY : LengthValue = 585 [mm];
      attribute centerZ : LengthValue = 820 [mm];
      attribute length : LengthValue = 70 [mm];
      attribute width : LengthValue = 350 [mm];
      attribute height : LengthValue = 85 [mm];
    }
    part RightSill {
      attribute shape : String = "box";
      attribute color : String = "#267BA0";
      attribute centerX : LengthValue = 0 [mm];
      attribute centerY : LengthValue = -830 [mm];
      attribute centerZ : LengthValue = 440 [mm];
      attribute length : LengthValue = 2020 [mm];
      attribute width : LengthValue = 90 [mm];
      attribute height : LengthValue = 170 [mm];
    }
    part frontRightWheelBrow {
      attribute shape : String = "loft";
      attribute color : String = "#267BA0";
      attribute centerX : LengthValue = 0 [mm];
      attribute centerY : LengthValue = 0 [mm];
      attribute centerZ : LengthValue = 0 [mm];
      attribute section1X : LengthValue = 995 [mm];
      attribute section1Y : LengthValue = -865 [mm];
      attribute section1Z : LengthValue = 610 [mm];
      attribute section1Width : LengthValue = 55 [mm];
      attribute section1Height : LengthValue = 45 [mm];
      attribute section2X : LengthValue = 1100 [mm];
      attribute section2Y : LengthValue = -865 [mm];
      attribute section2Z : LengthValue = 735 [mm];
      attribute section2Width : LengthValue = 80 [mm];
      attribute section2Height : LengthValue = 45 [mm];
      attribute section3X : LengthValue = 1400 [mm];
      attribute section3Y : LengthValue = -865 [mm];
      attribute section3Z : LengthValue = 785 [mm];
      attribute section3Width : LengthValue = 90 [mm];
      attribute section3Height : LengthValue = 45 [mm];
      attribute section4X : LengthValue = 1700 [mm];
      attribute section4Y : LengthValue = -865 [mm];
      attribute section4Z : LengthValue = 735 [mm];
      attribute section4Width : LengthValue = 80 [mm];
      attribute section4Height : LengthValue = 45 [mm];
      attribute section5X : LengthValue = 1805 [mm];
      attribute section5Y : LengthValue = -865 [mm];
      attribute section5Z : LengthValue = 610 [mm];
      attribute section5Width : LengthValue = 55 [mm];
      attribute section5Height : LengthValue = 45 [mm];
    }
    part rearRightWheelBrow {
      attribute shape : String = "loft";
      attribute color : String = "#267BA0";
      attribute centerX : LengthValue = 0 [mm];
      attribute centerY : LengthValue = 0 [mm];
      attribute centerZ : LengthValue = 0 [mm];
      attribute section1X : LengthValue = -1805 [mm];
      attribute section1Y : LengthValue = -865 [mm];
      attribute section1Z : LengthValue = 610 [mm];
      attribute section1Width : LengthValue = 55 [mm];
      attribute section1Height : LengthValue = 45 [mm];
      attribute section2X : LengthValue = -1700 [mm];
      attribute section2Y : LengthValue = -865 [mm];
      attribute section2Z : LengthValue = 735 [mm];
      attribute section2Width : LengthValue = 80 [mm];
      attribute section2Height : LengthValue = 45 [mm];
      attribute section3X : LengthValue = -1400 [mm];
      attribute section3Y : LengthValue = -865 [mm];
      attribute section3Z : LengthValue = 785 [mm];
      attribute section3Width : LengthValue = 90 [mm];
      attribute section3Height : LengthValue = 45 [mm];
      attribute section4X : LengthValue = -1100 [mm];
      attribute section4Y : LengthValue = -865 [mm];
      attribute section4Z : LengthValue = 735 [mm];
      attribute section4Width : LengthValue = 80 [mm];
      attribute section4Height : LengthValue = 45 [mm];
      attribute section5X : LengthValue = -995 [mm];
      attribute section5Y : LengthValue = -865 [mm];
      attribute section5Z : LengthValue = 610 [mm];
      attribute section5Width : LengthValue = 55 [mm];
      attribute section5Height : LengthValue = 45 [mm];
    }
    part RightWaist {
      attribute shape : String = "loft";
      attribute color : String = "#267BA0";
      attribute centerX : LengthValue = 0 [mm];
      attribute centerY : LengthValue = 0 [mm];
      attribute centerZ : LengthValue = 0 [mm];
      attribute section1X : LengthValue = -2220 [mm];
      attribute section1Y : LengthValue = -820 [mm];
      attribute section1Z : LengthValue = 735 [mm];
      attribute section1Width : LengthValue = 70 [mm];
      attribute section1Height : LengthValue = 70 [mm];
      attribute section2X : LengthValue = -1850 [mm];
      attribute section2Y : LengthValue = -860 [mm];
      attribute section2Z : LengthValue = 835 [mm];
      attribute section2Width : LengthValue = 70 [mm];
      attribute section2Height : LengthValue = 80 [mm];
      attribute section3X : LengthValue = -900 [mm];
      attribute section3Y : LengthValue = -875 [mm];
      attribute section3Z : LengthValue = 865 [mm];
      attribute section3Width : LengthValue = 70 [mm];
      attribute section3Height : LengthValue = 80 [mm];
      attribute section4X : LengthValue = 400 [mm];
      attribute section4Y : LengthValue = -870 [mm];
      attribute section4Z : LengthValue = 890 [mm];
      attribute section4Width : LengthValue = 70 [mm];
      attribute section4Height : LengthValue = 80 [mm];
      attribute section5X : LengthValue = 1150 [mm];
      attribute section5Y : LengthValue = -850 [mm];
      attribute section5Z : LengthValue = 850 [mm];
      attribute section5Width : LengthValue = 70 [mm];
      attribute section5Height : LengthValue = 75 [mm];
      attribute section6X : LengthValue = 2200 [mm];
      attribute section6Y : LengthValue = -760 [mm];
      attribute section6Z : LengthValue = 710 [mm];
      attribute section6Width : LengthValue = 65 [mm];
      attribute section6Height : LengthValue = 65 [mm];
    }
    part RightRoofRail {
      attribute shape : String = "loft";
      attribute color : String = "#267BA0";
      attribute centerX : LengthValue = 0 [mm];
      attribute centerY : LengthValue = 0 [mm];
      attribute centerZ : LengthValue = 0 [mm];
      attribute section1X : LengthValue = -1150 [mm];
      attribute section1Y : LengthValue = -690 [mm];
      attribute section1Z : LengthValue = 1000 [mm];
      attribute section1Width : LengthValue = 65 [mm];
      attribute section1Height : LengthValue = 65 [mm];
      attribute section2X : LengthValue = -650 [mm];
      attribute section2Y : LengthValue = -665 [mm];
      attribute section2Z : LengthValue = 1360 [mm];
      attribute section2Width : LengthValue = 65 [mm];
      attribute section2Height : LengthValue = 65 [mm];
      attribute section3X : LengthValue = -250 [mm];
      attribute section3Y : LengthValue = -655 [mm];
      attribute section3Z : LengthValue = 1450 [mm];
      attribute section3Width : LengthValue = 65 [mm];
      attribute section3Height : LengthValue = 65 [mm];
      attribute section4X : LengthValue = 300 [mm];
      attribute section4Y : LengthValue = -655 [mm];
      attribute section4Z : LengthValue = 1465 [mm];
      attribute section4Width : LengthValue = 65 [mm];
      attribute section4Height : LengthValue = 65 [mm];
      attribute section5X : LengthValue = 650 [mm];
      attribute section5Y : LengthValue = -665 [mm];
      attribute section5Z : LengthValue = 1405 [mm];
      attribute section5Width : LengthValue = 65 [mm];
      attribute section5Height : LengthValue = 65 [mm];
      attribute section6X : LengthValue = 1050 [mm];
      attribute section6Y : LengthValue = -740 [mm];
      attribute section6Z : LengthValue = 1000 [mm];
      attribute section6Width : LengthValue = 65 [mm];
      attribute section6Height : LengthValue = 65 [mm];
    }
    part RightGlass {
      attribute shape : String = "loft";
      attribute color : String = "#29434F";
      attribute centerX : LengthValue = 0 [mm];
      attribute centerY : LengthValue = 0 [mm];
      attribute centerZ : LengthValue = 0 [mm];
      attribute section1X : LengthValue = -1000 [mm];
      attribute section1Y : LengthValue = -720 [mm];
      attribute section1Z : LengthValue = 1040 [mm];
      attribute section1Width : LengthValue = 40 [mm];
      attribute section1Height : LengthValue = 160 [mm];
      attribute section2X : LengthValue = -550 [mm];
      attribute section2Y : LengthValue = -700 [mm];
      attribute section2Z : LengthValue = 1270 [mm];
      attribute section2Width : LengthValue = 40 [mm];
      attribute section2Height : LengthValue = 220 [mm];
      attribute section3X : LengthValue = 450 [mm];
      attribute section3Y : LengthValue = -700 [mm];
      attribute section3Z : LengthValue = 1290 [mm];
      attribute section3Width : LengthValue = 40 [mm];
      attribute section3Height : LengthValue = 215 [mm];
      attribute section4X : LengthValue = 900 [mm];
      attribute section4Y : LengthValue = -750 [mm];
      attribute section4Z : LengthValue = 1050 [mm];
      attribute section4Width : LengthValue = 40 [mm];
      attribute section4Height : LengthValue = 160 [mm];
    }
    part RightMirror {
      attribute shape : String = "box";
      attribute color : String = "#267BA0";
      attribute centerX : LengthValue = 850 [mm];
      attribute centerY : LengthValue = -1000 [mm];
      attribute centerZ : LengthValue = 1050 [mm];
      attribute length : LengthValue = 200 [mm];
      attribute width : LengthValue = 140 [mm];
      attribute height : LengthValue = 90 [mm];
    }
    part RightMirrorStem {
      attribute shape : String = "box";
      attribute color : String = "#596675";
      attribute centerX : LengthValue = 850 [mm];
      attribute centerY : LengthValue = -890 [mm];
      attribute centerZ : LengthValue = 1030 [mm];
      attribute length : LengthValue = 65 [mm];
      attribute width : LengthValue = 90 [mm];
      attribute height : LengthValue = 30 [mm];
    }
    part RightHood {
      attribute shape : String = "loft";
      attribute color : String = "#267BA0";
      attribute centerX : LengthValue = 0 [mm];
      attribute centerY : LengthValue = 0 [mm];
      attribute centerZ : LengthValue = 0 [mm];
      attribute section1X : LengthValue = 1120 [mm];
      attribute section1Y : LengthValue = -640 [mm];
      attribute section1Z : LengthValue = 890 [mm];
      attribute section1Width : LengthValue = 340 [mm];
      attribute section1Height : LengthValue = 45 [mm];
      attribute section2X : LengthValue = 1700 [mm];
      attribute section2Y : LengthValue = -630 [mm];
      attribute section2Z : LengthValue = 855 [mm];
      attribute section2Width : LengthValue = 340 [mm];
      attribute section2Height : LengthValue = 45 [mm];
      attribute section3X : LengthValue = 2200 [mm];
      attribute section3Y : LengthValue = -570 [mm];
      attribute section3Z : LengthValue = 770 [mm];
      attribute section3Width : LengthValue = 300 [mm];
      attribute section3Height : LengthValue = 45 [mm];
    }
    part RightHeadlamp {
      attribute shape : String = "box";
      attribute color : String = "#E5EBDB";
      attribute centerX : LengthValue = 2245 [mm];
      attribute centerY : LengthValue = -565 [mm];
      attribute centerZ : LengthValue = 760 [mm];
      attribute length : LengthValue = 75 [mm];
      attribute width : LengthValue = 360 [mm];
      attribute height : LengthValue = 95 [mm];
    }
    part RightTaillamp {
      attribute shape : String = "box";
      attribute color : String = "#A54857";
      attribute centerX : LengthValue = -2260 [mm];
      attribute centerY : LengthValue = -585 [mm];
      attribute centerZ : LengthValue = 820 [mm];
      attribute length : LengthValue = 70 [mm];
      attribute width : LengthValue = 350 [mm];
      attribute height : LengthValue = 85 [mm];
    }
    part Nose {
      attribute shape : String = "loft";
      attribute color : String = "#267BA0";
      attribute centerX : LengthValue = 0 [mm];
      attribute centerY : LengthValue = 0 [mm];
      attribute centerZ : LengthValue = 0 [mm];
      attribute section1X : LengthValue = 2220 [mm];
      attribute section1Y : LengthValue = 0 [mm];
      attribute section1Z : LengthValue = 590 [mm];
      attribute section1Width : LengthValue = 1600 [mm];
      attribute section1Height : LengthValue = 320 [mm];
      attribute section2X : LengthValue = 2350 [mm];
      attribute section2Y : LengthValue = 0 [mm];
      attribute section2Z : LengthValue = 555 [mm];
      attribute section2Width : LengthValue = 1450 [mm];
      attribute section2Height : LengthValue = 220 [mm];
    }
    part Tail {
      attribute shape : String = "loft";
      attribute color : String = "#267BA0";
      attribute centerX : LengthValue = 0 [mm];
      attribute centerY : LengthValue = 0 [mm];
      attribute centerZ : LengthValue = 0 [mm];
      attribute section1X : LengthValue = -2350 [mm];
      attribute section1Y : LengthValue = 0 [mm];
      attribute section1Z : LengthValue = 640 [mm];
      attribute section1Width : LengthValue = 1450 [mm];
      attribute section1Height : LengthValue = 290 [mm];
      attribute section2X : LengthValue = -2200 [mm];
      attribute section2Y : LengthValue = 0 [mm];
      attribute section2Z : LengthValue = 690 [mm];
      attribute section2Width : LengthValue = 1690 [mm];
      attribute section2Height : LengthValue = 380 [mm];
    }
    part Trunk {
      attribute shape : String = "loft";
      attribute color : String = "#267BA0";
      attribute centerX : LengthValue = 0 [mm];
      attribute centerY : LengthValue = 0 [mm];
      attribute centerZ : LengthValue = 0 [mm];
      attribute section1X : LengthValue = -2210 [mm];
      attribute section1Y : LengthValue = 0 [mm];
      attribute section1Z : LengthValue = 885 [mm];
      attribute section1Width : LengthValue = 1660 [mm];
      attribute section1Height : LengthValue = 40 [mm];
      attribute section2X : LengthValue = -1650 [mm];
      attribute section2Y : LengthValue = 0 [mm];
      attribute section2Z : LengthValue = 935 [mm];
      attribute section2Width : LengthValue = 1700 [mm];
      attribute section2Height : LengthValue = 40 [mm];
      attribute section3X : LengthValue = -1170 [mm];
      attribute section3Y : LengthValue = 0 [mm];
      attribute section3Z : LengthValue = 970 [mm];
      attribute section3Width : LengthValue = 1600 [mm];
      attribute section3Height : LengthValue = 40 [mm];
    }
    part FrontBumper {
      attribute shape : String = "box";
      attribute color : String = "#596675";
      attribute centerX : LengthValue = 2310 [mm];
      attribute centerY : LengthValue = 0 [mm];
      attribute centerZ : LengthValue = 385 [mm];
      attribute length : LengthValue = 110 [mm];
      attribute width : LengthValue = 1450 [mm];
      attribute height : LengthValue = 90 [mm];
    }
    part RearBumper {
      attribute shape : String = "box";
      attribute color : String = "#596675";
      attribute centerX : LengthValue = -2310 [mm];
      attribute centerY : LengthValue = 0 [mm];
      attribute centerZ : LengthValue = 390 [mm];
      attribute length : LengthValue = 110 [mm];
      attribute width : LengthValue = 1450 [mm];
      attribute height : LengthValue = 90 [mm];
    }
    part roofBowN570 {
      attribute shape : String = "box";
      attribute color : String = "#267BA0";
      attribute centerX : LengthValue = -570 [mm];
      attribute centerY : LengthValue = 0 [mm];
      attribute centerZ : LengthValue = 1400 [mm];
      attribute length : LengthValue = 60 [mm];
      attribute width : LengthValue = 1290 [mm];
      attribute height : LengthValue = 35 [mm];
    }
    part roofBow100 {
      attribute shape : String = "box";
      attribute color : String = "#267BA0";
      attribute centerX : LengthValue = 100 [mm];
      attribute centerY : LengthValue = 0 [mm];
      attribute centerZ : LengthValue = 1470 [mm];
      attribute length : LengthValue = 60 [mm];
      attribute width : LengthValue = 1300 [mm];
      attribute height : LengthValue = 35 [mm];
    }
    part roofBow570 {
      attribute shape : String = "box";
      attribute color : String = "#267BA0";
      attribute centerX : LengthValue = 570 [mm];
      attribute centerY : LengthValue = 0 [mm];
      attribute centerZ : LengthValue = 1430 [mm];
      attribute length : LengthValue = 60 [mm];
      attribute width : LengthValue = 1310 [mm];
      attribute height : LengthValue = 35 [mm];
    }
  }
}
