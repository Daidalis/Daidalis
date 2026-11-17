// ElectricSedan concept geometry. Units: mm; +X front; +Z up; ground z=0.
// Physical longitudinal cutaway. Faceted multi-station loft, not Class-A surfacing.
$fn=48;
module box(p,s,c){color(c) translate(p) cube(s,center=true);}
module cyl(p,r,h,c){color(c) translate(p) rotate([90,0,0]) cylinder(r=r,h=h,center=true);}
box([0,550,330],[2680,300,45],"#607080");
box([0,-550,330],[2680,300,45],"#607080");
box([-100,0,230],[2150,1240,125],"#D49C38");
box([1480,0,650],[380,460,150],"#3EAAAD");
cyl([1420,0,420],155,520,"#C87140");
box([1170,0,245],[260,1150,65],"#607080");
box([-1350,0,245],[240,1150,65],"#607080");
module corner(x,y){
 cyl([x,y,325],325,215,"#20252B");
 cyl([x,y+sign(y)*115,325],215,12,"#B9C6D0");
 cyl([x,sign(y)*470,360],24,360,"#B9C6D0");
 box([x,sign(y)*540,210],[280,260,35],"#607080");
 color("#B9C6D0") translate([x,sign(y)*650,540]) cylinder(r=38,h=330,center=true);
 color("#D49C38") translate([x,sign(y)*650,570]) cylinder(r=62,h=170,center=true);
}
corner(1350,780); corner(1350,-780); corner(-1350,780); corner(-1350,-780);
// Shared sections: x, half width, bottom, shoulder; raised bottoms form wheel arches.
bodyStations=[[-2300,650,420,650],[-2100,790,350,760],[-1750,860,350,850],[-1500,880,700,890],[-1350,885,715,900],[-1150,885,655,920],[-900,890,350,940],[-500,900,350,960],[0,900,350,970],[500,890,350,960],[900,880,350,940],[1150,875,655,915],[1350,870,715,900],[1550,850,655,870],[1750,825,350,830],[2100,740,380,720],[2300,650,420,650]];
module rectSection(row){translate([row[0],row[1],row[2]]) cube([0.6,row[3],row[4]],center=true);}
module loft(rows){for(i=[0:len(rows)-2]) hull(){rectSection(rows[i]);rectSection(rows[i+1]);}}
module sweepRect(path,w,h){for(i=[0:len(path)-2]) hull(){translate(path[i]) cube([0.6,w,h],center=true);translate(path[i+1]) cube([0.6,w,h],center=true);}}
for(s=[-1,1]){
 color("#426F95") loft([for(a=bodyStations) [a[0],s*(a[1]-25),(a[2]+a[3]-35)/2,50,a[3]-35-a[2]]]);
 color("#527EA1") loft([for(a=bodyStations) [a[0],s*(a[1]-55),a[3]-10,110,40]]);
 color("#426F95") loft([[900,s*680,930,220,26],[1350,s*660,900,220,26],[1750,s*620,825,220,26],[2100,s*600,720,140,26]]);
 color("#426F95") loft([[-2100,s*600,760,140,26],[-1750,s*640,850,220,26],[-1450,s*680,900,220,26]]);
 color("#447884") loft([[-1400,s*715,940,90,80],[-1000,s*690,1090,70,240],[-600,s*650,1200,55,390],[0,s*650,1230,55,420],[550,s*690,1160,65,300],[900,s*725,990,80,100]]);
 color("#A5B7C5") sweepRect([[-950,s*875,360],[850,s*865,360]],38,32);
 color("#A5B7C5") sweepRect([[-2100,s*790,780],[-1000,s*890,945],[0,s*900,975],[900,s*880,945],[2100,s*740,740]],38,32);
 color("#A5B7C5") sweepRect([[-1450,s*720,980],[-1000,s*690,1270],[-600,s*650,1420],[0,s*650,1450],[500,s*680,1350],[950,s*750,1030]],35,30);
 box([2200,s*630,640],[95,220,65],"#E8EFE5");
 box([-2210,s*620,660],[80,230,65],"#B5433F");
 box([650,s*910,1040],[60,160,25],"#A5B7C5");
 box([650,s*1040,1070],[150,100,85],"#426F95");
}
box([2270,0,510],[50,1200,150],"#426F95");
box([-2270,0,510],[50,1200,150],"#426F95");
