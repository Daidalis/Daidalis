// ElectricSedan concept geometry. Units: mm; +X front; +Z up; ground z=0.
$fn=48;
module box(p,s,c){color(c) translate(p) cube(s,center=true);}
module cyl(p,r,h,c){color(c) translate(p) rotate([90,0,0]) cylinder(r=r,h=h,center=true);}
box([0,550,330],[2680,300,45],"SlateGray");
box([0,-550,330],[2680,300,45],"SlateGray");
box([-100,0,230],[2150,1240,125],"Goldenrod");
box([1480,0,650],[380,460,150],"CadetBlue");
cyl([1420,0,420],155,520,"Peru");
box([1170,0,245],[260,1150,65],"SlateGray");
box([-1350,0,245],[240,1150,65],"SlateGray");
