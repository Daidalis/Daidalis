package SedanAppearance {
 private import ScalarValues::*;
 private import ISQ::*;
 private import SI::*;
 part def Box {
  attribute shape : String = "box";
  attribute length : LengthValue;
  attribute width : LengthValue;
  attribute height : LengthValue;
  attribute centerX : LengthValue;
  attribute centerY : LengthValue;
  attribute centerZ : LengthValue;
  attribute color : String = "#607080";
 }
 part def Cylinder {
  attribute shape : String = "cylinder";
  attribute radius : LengthValue;
  attribute height : LengthValue;
  attribute axis : String = "Y";
  attribute centerX : LengthValue;
  attribute centerY : LengthValue;
  attribute centerZ : LengthValue;
  attribute color : String = "#30343B";
 }
 part sedan {
  doc /* Concept geometry; all lengths mm, +X front, +Z up, ground Z=0. 4600 long, 2700 wheelbase, 1560 track. Central inspection opening preserves visibility. */
  part floorLeft : Box { :>> length = 2680 [mm]; :>> width = 300 [mm]; :>> height = 45 [mm]; :>> centerX = 0 [mm]; :>> centerY = 550 [mm]; :>> centerZ = 330 [mm]; }
  part floorRight : Box { :>> length = 2680 [mm]; :>> width = 300 [mm]; :>> height = 45 [mm]; :>> centerX = 0 [mm]; :>> centerY = -550 [mm]; :>> centerZ = 330 [mm]; }
  part battery : Box { :>> length = 2150 [mm]; :>> width = 1240 [mm]; :>> height = 125 [mm]; :>> centerX = -100 [mm]; :>> centerY = 0 [mm]; :>> centerZ = 230 [mm]; :>> color = "#D49C38"; }
  part inverter : Box { :>> length = 380 [mm]; :>> width = 460 [mm]; :>> height = 150 [mm]; :>> centerX = 1480 [mm]; :>> centerY = 0 [mm]; :>> centerZ = 650 [mm]; :>> color = "#3EAAAD"; }
  part motor : Cylinder { :>> radius = 155 [mm]; :>> height = 520 [mm]; :>> centerX = 1420 [mm]; :>> centerY = 0 [mm]; :>> centerZ = 420 [mm]; :>> color = "#C87140"; }
  part frontSubframe : Box { :>> length = 260 [mm]; :>> width = 1150 [mm]; :>> height = 65 [mm]; :>> centerX = 1170 [mm]; :>> centerY = 0 [mm]; :>> centerZ = 245 [mm]; }
  part rearSubframe : Box { :>> length = 240 [mm]; :>> width = 1150 [mm]; :>> height = 65 [mm]; :>> centerX = -1350 [mm]; :>> centerY = 0 [mm]; :>> centerZ = 245 [mm]; }
 }
}
