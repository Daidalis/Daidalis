// Units mm; +X forward +Z up; ground z=0. Exact delivered SysML geometry.
$fn=64;
module sec(a){translate([a[0],a[1],a[2]]) cube([0.1,a[3],a[4]],center=true);}
module loft(a){for(i=[0:len(a)-2]) hull(){sec(a[i]);sec(a[i+1]);}}
// floorLeft
color("slategray") translate([-150.0, 655.0, 365.0]) cube([2480.0, 170.0, 55.0],center=true);
// floorRight
color("slategray") translate([-150.0, -655.0, 365.0]) cube([2480.0, 170.0, 55.0],center=true);
// battery
color("darkorange") translate([-150.0, 0.0, 255.0]) cube([2180.0, 1100.0, 150.0],center=true);
// inverter
color("deepskyblue") translate([1610.0, 0.0, 650.0]) cube([340.0, 540.0, 180.0],center=true);
// motor
color("mediumseagreen") translate([1350.0, 0.0, 395.0]) rotate([90,0,0]) cylinder(r=180.0,h=610.0,center=true);
// frontLeftTire
color("dimgray") translate([1400.0, 850.0, 330.0]) rotate([90,0,0]) cylinder(r=330.0,h=215.0,center=true);
// frontLeftRim
color("silver") translate([1400.0, 964.0, 330.0]) rotate([90,0,0]) cylinder(r=235.0,h=12.0,center=true);
// frontLeftArm
color("steelblue") translate([1400.0, 555.0, 285.0]) cube([340.0, 65.0, 40.0],center=true);
// frontLeftSpring
color("goldenrod") translate([1400.0, 690.0, 480.0]) cylinder(r=55.0,h=230.0,center=true);
// frontLeftHalfshaft
color("silver") translate([1350.0, 520.0, 395.0]) rotate([90,0,0]) cylinder(r=22.0,h=390.0,center=true);
// frontRightTire
color("dimgray") translate([1400.0, -850.0, 330.0]) rotate([90,0,0]) cylinder(r=330.0,h=215.0,center=true);
// frontRightRim
color("silver") translate([1400.0, -964.0, 330.0]) rotate([90,0,0]) cylinder(r=235.0,h=12.0,center=true);
// frontRightArm
color("steelblue") translate([1400.0, -555.0, 285.0]) cube([340.0, 65.0, 40.0],center=true);
// frontRightSpring
color("goldenrod") translate([1400.0, -690.0, 480.0]) cylinder(r=55.0,h=230.0,center=true);
// frontRightHalfshaft
color("silver") translate([1350.0, -520.0, 395.0]) rotate([90,0,0]) cylinder(r=22.0,h=390.0,center=true);
// rearLeftTire
color("dimgray") translate([-1400.0, 850.0, 330.0]) rotate([90,0,0]) cylinder(r=330.0,h=215.0,center=true);
// rearLeftRim
color("silver") translate([-1400.0, 964.0, 330.0]) rotate([90,0,0]) cylinder(r=235.0,h=12.0,center=true);
// rearLeftArm
color("steelblue") translate([-1400.0, 555.0, 285.0]) cube([340.0, 65.0, 40.0],center=true);
// rearLeftSpring
color("goldenrod") translate([-1400.0, 690.0, 480.0]) cylinder(r=55.0,h=230.0,center=true);
// rearRightTire
color("dimgray") translate([-1400.0, -850.0, 330.0]) rotate([90,0,0]) cylinder(r=330.0,h=215.0,center=true);
// rearRightRim
color("silver") translate([-1400.0, -964.0, 330.0]) rotate([90,0,0]) cylinder(r=235.0,h=12.0,center=true);
// rearRightArm
color("steelblue") translate([-1400.0, -555.0, 285.0]) cube([340.0, 65.0, 40.0],center=true);
// rearRightSpring
color("goldenrod") translate([-1400.0, -690.0, 480.0]) cylinder(r=55.0,h=230.0,center=true);
// frontRightFrameRail
color("slategray") translate([1400.0, -420.0, 190.0]) cube([640.0, 65.0, 70.0],center=true);
// frontLeftFrameRail
color("slategray") translate([1400.0, 420.0, 190.0]) cube([640.0, 65.0, 70.0],center=true);
// frontACrossmember
color("slategray") translate([1100.0, 0.0, 190.0]) cube([55.0, 780.0, 65.0],center=true);
// frontBCrossmember
color("slategray") translate([1700.0, 0.0, 190.0]) cube([55.0, 780.0, 65.0],center=true);
// rearRightFrameRail
color("slategray") translate([-1400.0, -420.0, 190.0]) cube([640.0, 65.0, 70.0],center=true);
// rearLeftFrameRail
color("slategray") translate([-1400.0, 420.0, 190.0]) cube([640.0, 65.0, 70.0],center=true);
// rearACrossmember
color("slategray") translate([-1700.0, 0.0, 190.0]) cube([55.0, 780.0, 65.0],center=true);
// rearBCrossmember
color("slategray") translate([-1100.0, 0.0, 190.0]) cube([55.0, 780.0, 65.0],center=true);
// leftShoulder
color("royalblue") loft([[-2300.0, 635.0, 710.0, 45.0, 22.0], [-1900.0, 835.0, 850.0, 75.0, 24.0], [-1000.0, 860.0, 925.0, 120.0, 24.0], [-250.0, 855.0, 1040.0, 130.0, 24.0], [400.0, 855.0, 1020.0, 130.0, 24.0], [1000.0, 860.0, 930.0, 120.0, 24.0], [1900.0, 835.0, 820.0, 75.0, 24.0], [2300.0, 635.0, 685.0, 45.0, 22.0]]);
// rightShoulder
color("royalblue") loft([[-2300.0, -635.0, 710.0, 45.0, 22.0], [-1900.0, -835.0, 850.0, 75.0, 24.0], [-1000.0, -860.0, 925.0, 120.0, 24.0], [-250.0, -855.0, 1040.0, 130.0, 24.0], [400.0, -855.0, 1020.0, 130.0, 24.0], [1000.0, -860.0, 930.0, 120.0, 24.0], [1900.0, -835.0, 820.0, 75.0, 24.0], [2300.0, -635.0, 685.0, 45.0, 22.0]]);
// leftRoof
color("royalblue") loft([[-2300.0, 625.0, 735.0, 30.0, 14.0], [-1850.0, 730.0, 875.0, 200.0, 14.0], [-1000.0, 730.0, 1090.0, 200.0, 14.0], [-500.0, 700.0, 1420.0, 140.0, 14.0], [-200.0, 700.0, 1490.0, 140.0, 14.0], [200.0, 700.0, 1470.0, 140.0, 14.0], [500.0, 700.0, 1350.0, 140.0, 14.0], [1000.0, 730.0, 990.0, 200.0, 14.0], [1850.0, 730.0, 850.0, 200.0, 14.0], [2300.0, 625.0, 710.0, 30.0, 14.0]]);
// rightRoof
color("royalblue") loft([[-2300.0, -625.0, 735.0, 30.0, 14.0], [-1850.0, -730.0, 875.0, 200.0, 14.0], [-1000.0, -730.0, 1090.0, 200.0, 14.0], [-500.0, -700.0, 1420.0, 140.0, 14.0], [-200.0, -700.0, 1490.0, 140.0, 14.0], [200.0, -700.0, 1470.0, 140.0, 14.0], [500.0, -700.0, 1350.0, 140.0, 14.0], [1000.0, -730.0, 990.0, 200.0, 14.0], [1850.0, -730.0, 850.0, 200.0, 14.0], [2300.0, -625.0, 710.0, 30.0, 14.0]]);
// leftGlass
color("lightsteelblue") loft([[-990.0, 805.0, 1000.0, 12.0, 120.0], [-500.0, 780.0, 1215.0, 12.0, 385.0], [-200.0, 780.0, 1265.0, 12.0, 430.0], [200.0, 780.0, 1250.0, 12.0, 420.0], [500.0, 780.0, 1175.0, 12.0, 315.0], [990.0, 805.0, 955.0, 12.0, 45.0]]);
// rightGlass
color("lightsteelblue") loft([[-990.0, -805.0, 1000.0, 12.0, 120.0], [-500.0, -780.0, 1215.0, 12.0, 385.0], [-200.0, -780.0, 1265.0, 12.0, 430.0], [200.0, -780.0, 1250.0, 12.0, 420.0], [500.0, -780.0, 1175.0, 12.0, 315.0], [990.0, -805.0, 955.0, 12.0, 45.0]]);
// leftDoorSkin
color("royalblue") loft([[-1010.0, 890.0, 630.0, 24.0, 500.0], [-300.0, 910.0, 660.0, 24.0, 560.0], [400.0, 910.0, 655.0, 24.0, 550.0], [1010.0, 890.0, 630.0, 24.0, 500.0]]);
// rightDoorSkin
color("royalblue") loft([[-1010.0, -890.0, 630.0, 24.0, 500.0], [-300.0, -910.0, 660.0, 24.0, 560.0], [400.0, -910.0, 655.0, 24.0, 550.0], [1010.0, -890.0, 630.0, 24.0, 500.0]]);
// leftFrontArch
color("royalblue") loft([[1020.0, 890.0, 820.0, 24.0, 180.0], [1400.0, 900.0, 785.0, 24.0, 140.0], [1780.0, 870.0, 760.0, 24.0, 70.0]]);
// rightFrontArch
color("royalblue") loft([[1020.0, -890.0, 820.0, 24.0, 180.0], [1400.0, -900.0, 785.0, 24.0, 140.0], [1780.0, -870.0, 760.0, 24.0, 70.0]]);
// leftRearArch
color("royalblue") loft([[-1780.0, 870.0, 800.0, 24.0, 140.0], [-1400.0, 900.0, 815.0, 24.0, 170.0], [-1020.0, 890.0, 850.0, 24.0, 220.0]]);
// rightRearArch
color("royalblue") loft([[-1780.0, -870.0, 800.0, 24.0, 140.0], [-1400.0, -900.0, 815.0, 24.0, 170.0], [-1020.0, -890.0, 850.0, 24.0, 220.0]]);
// leftNose
color("royalblue") loft([[1790.0, 870.0, 550.0, 24.0, 320.0], [2200.0, 755.0, 540.0, 24.0, 280.0], [2300.0, 635.0, 535.0, 24.0, 250.0]]);
// rightNose
color("royalblue") loft([[1790.0, -870.0, 550.0, 24.0, 320.0], [2200.0, -755.0, 540.0, 24.0, 280.0], [2300.0, -635.0, 535.0, 24.0, 250.0]]);
// leftTail
color("royalblue") loft([[-2300.0, 635.0, 545.0, 24.0, 260.0], [-2200.0, 755.0, 555.0, 24.0, 300.0], [-1790.0, 870.0, 575.0, 24.0, 360.0]]);
// rightTail
color("royalblue") loft([[-2300.0, -635.0, 545.0, 24.0, 260.0], [-2200.0, -755.0, 555.0, 24.0, 300.0], [-1790.0, -870.0, 575.0, 24.0, 360.0]]);
// leftSill
color("midnightblue") loft([[-1010.0, 850.0, 365.0, 90.0, 65.0], [0.0, 870.0, 355.0, 90.0, 65.0], [1010.0, 850.0, 365.0, 90.0, 65.0]]);
// rightSill
color("midnightblue") loft([[-1010.0, -850.0, 365.0, 90.0, 65.0], [0.0, -870.0, 355.0, 90.0, 65.0], [1010.0, -850.0, 365.0, 90.0, 65.0]]);
// leftBeltline
color("silver") loft([[-1010.0, 905.0, 890.0, 20.0, 20.0], [0.0, 925.0, 950.0, 20.0, 20.0], [1010.0, 905.0, 890.0, 20.0, 20.0]]);
// rightBeltline
color("silver") loft([[-1010.0, -905.0, 890.0, 20.0, 20.0], [0.0, -925.0, 950.0, 20.0, 20.0], [1010.0, -905.0, 890.0, 20.0, 20.0]]);
// leftRoofRail
color("midnightblue") loft([[-1000.0, 650.0, 1100.0, 32.0, 32.0], [-500.0, 650.0, 1435.0, 32.0, 32.0], [-200.0, 650.0, 1505.0, 32.0, 32.0], [200.0, 650.0, 1485.0, 32.0, 32.0], [500.0, 650.0, 1365.0, 32.0, 32.0], [1000.0, 650.0, 1005.0, 32.0, 32.0]]);
// rightRoofRail
color("midnightblue") loft([[-1000.0, -650.0, 1100.0, 32.0, 32.0], [-500.0, -650.0, 1435.0, 32.0, 32.0], [-200.0, -650.0, 1505.0, 32.0, 32.0], [200.0, -650.0, 1485.0, 32.0, 32.0], [500.0, -650.0, 1365.0, 32.0, 32.0], [1000.0, -650.0, 1005.0, 32.0, 32.0]]);
// leftHeadlight
color("lightyellow") loft([[2210.0, 565.0, 690.0, 270.0, 48.0], [2280.0, 530.0, 675.0, 230.0, 42.0]]);
// rightHeadlight
color("lightyellow") loft([[2210.0, -565.0, 690.0, 270.0, 48.0], [2280.0, -530.0, 675.0, 230.0, 42.0]]);
// leftTaillight
color("crimson") loft([[-2290.0, 520.0, 690.0, 240.0, 45.0], [-2220.0, 565.0, 715.0, 280.0, 50.0]]);
// rightTaillight
color("crimson") loft([[-2290.0, -520.0, 690.0, 240.0, 45.0], [-2220.0, -565.0, 715.0, 280.0, 50.0]]);
// leftMirrorStem
color("dimgray") translate([700.0, 950.0, 1020.0]) cube([95.0, 70.0, 28.0],center=true);
// rightMirrorStem
color("dimgray") translate([700.0, -950.0, 1020.0]) cube([95.0, 70.0, 28.0],center=true);
// leftMirror
color("royalblue") loft([[640.0, 1020.0, 1040.0, 115.0, 65.0], [690.0, 1035.0, 1050.0, 150.0, 80.0], [770.0, 1020.0, 1040.0, 105.0, 60.0]]);
// rightMirror
color("royalblue") loft([[640.0, -1020.0, 1040.0, 115.0, 65.0], [690.0, -1035.0, 1050.0, 150.0, 80.0], [770.0, -1020.0, 1040.0, 105.0, 60.0]]);
// frontBumper
color("midnightblue") translate([2280.0, 0.0, 470.0]) cube([45.0, 1290.0, 120.0],center=true);
// rearBumper
color("midnightblue") translate([-2280.0, 0.0, 470.0]) cube([45.0, 1290.0, 120.0],center=true);
