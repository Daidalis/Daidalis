#!/usr/bin/env python3
"""Bounded native NASA 42 orbit run inside Manta's private Linux VM.

This adapter only changes reviewed fields in a copied 42 InOut scenario. The
native 42 executable runs in a networkless bubblewrap namespace. It does not
calculate coverage, revisit, ground contacts, delivery, or mission acceptance.
"""
import base64
import csv
import datetime as dt
import hashlib
import io
import json
import math
import os
import pathlib
import re
import resource
import shutil
import signal
import stat
import subprocess
import sys
import time

ROOT = pathlib.Path('/srv/manta/orbit42')
JOBS = ROOT / 'jobs'
SOURCE = pathlib.Path('/srv/manta/42')
BINARY = SOURCE / '42'
EXPECTED_BINARY_SHA256 = 'a56f32e7a0ce8ec7e26749a5fb7aee673f24a190f444fc85083b3c63bd2b6c31'

# Reviewed against the pinned source/integrity.json (SHA-256 fadfb8bd...);
# reject any changed or added native scenario template before modifying inputs.
EXPECTED_TEMPLATE_SHA256 = {
    'Flex_Simple.txt': '75c0e8137030eab1e418c3896443ee4d485a17cb46c80a97203832d1407ff5f8',
    'Inp_AcOutput.txt': '7cdffe151804f5fa1994aef5974d2606958a3520327c9e8864ff8ed47530d5a5',
    'Inp_Cmd.txt': '3958d7b1a5fa211b33537381aa9f5aabef7db0840c40544bf2389588cf9826e4',
    'Inp_CommLink.txt': '05deac229633a8b0d9c532c0c8fcd1090d882781cc764f21e9a42ff2668bee46',
    'Inp_FOV.txt': '374ab5192a666be3a49a56a20f580ceaf5712871ff3a7b040f0f7f63e422ebb1',
    'Inp_Graphics.txt': 'cbcf6cfdf2409a2f5bd64da9bbc03cd8600abe145431736f6fbdfddce8bcfcaa',
    'Inp_IPC.txt': '588d9a6aba2f5883de61300554bdd428054b663563961b389d320a7135d8f55b',
    'Inp_NOS3.txt': '54d8edaa051b44825a10c6897a334c78349b43ed9235d6fb319b1a1f00745f79',
    'Inp_Region.txt': '921f575b781c2813cdb8744c8d3c6bc8b9f17b15fccd03465764a1953c08c3f5',
    'Inp_ScOutput.txt': 'b9cca1f3620a80f07aa322813936fb9c1912d0e6c94fe9e66e3832caaa614c84',
    'Inp_Sim.txt': 'edb93d2646e8780fa0133ae9e752bb6592244f7f08be7e177280b7a0ac3bff63',
    'Inp_TDRS.txt': '991d7ae4b21b3fd7854032b327352f64bdf684773aa1fd7b916bc4fbcfc131cb',
    'Nodes_Simple.txt': 'efdcf66c3587e9d7375beea6dd8e652443ec286a50339ab5856b4d5b6174350a',
    'Optics_Simple.txt': 'd143e98006affe856f5773372610f91ceec6c7099b2dd2520c2ee761fb319302',
    'Orb_L3.txt': '77a1aba71355e0118506b8fa9f279e3dc76c5d03e4aacdd828e57c589058b9aa',
    'Orb_LEO.txt': '056618e73deee320fa40ae7010e6611d9d1fd06cbf8ce164c17fbbc32c2ba80c',
    'SC_SensorFOV.txt': '57900412ec5cd623a1fc6a4b564daab493cfdac995fa27b389e4aab313319db3',
    'SC_Simple.txt': '9c239e6b6ab6620b11ef6807f481b4944bd48000b85717995e89d55546075e58',
    'Shaker_Simple.txt': '5444004b0cfe1e73b817bf5a8c740b513d7cedaa3defc649336f0774b04b1594',
    'TRV.txt': 'f369dae3e022340c54aaea42747fd7419f79fb40b1cb963698c0a32e0d9496c9',
    'Whl_Simple.txt': '5dc72259fd6d465c94ae0fad18f9d86d38ebb0b0e0f491245a8fe68cab7541ed',
}
# Exact guest-local Model/World assets selected by pinned 42-assets-manifest.json
# (manifest SHA-256 de831c50..., source/integrity.json SHA-256 fadfb8bd...).
EXPECTED_ASSET_SHA256 = {
    'Model/1FGL Source Catalog.txt': 'c97697e13b22e61409bfc4d03bc372b43835a2cc0ec00274ecc6f256dc1849ca',
    'Model/42.mtl': 'ad2bef5a3cabaef574b79ec50f5dd76b4843456e2524f9774b09d319b1dea9a8',
    'Model/67P-CG.obj': '59df7d38b288ee936f8bca35ef027510d499ce1fcc45a5a9fc2857e6c2b51ce8',
    'Model/67P.obj': '0e1bd7b9f351866d340da9a9a5678acd7c9aaa48d1cbafab5a2f9d65eca375e1',
    'Model/ARC_ArmSegment.mtl': 'ab1312977bf3ba7b634407f6ea563a3bcb4f0f20c505271a09731d435d676d48',
    'Model/ARC_ArmSegment.obj': '2488cb3c7fef30796412565833ea9d4880077399b58307f56b761d342cd5ad4b',
    'Model/ARC_ChaserBody.mtl': '3eaa0af68728c5afcda27e9c39a0c6c414a057dd890207723a107e4011cab8e8',
    'Model/ARC_ChaserBody.obj': '2dd284529ddc8f86418e273b3bdfb42da537a0fb835b64c95a03841edb9b078b',
    'Model/ARC_ChaserSolarArray.mtl': '9709c80f4fe1fdea04a08ed67d1f05a132bdb86a930c8ec5a1b07cd28f1337f1',
    'Model/ARC_ChaserSolarArray.obj': 'deeeffc2c2f3ff4d478374ccc5ab7b7e4723a894717710dd565ebdeec103169a',
    'Model/ARC_Hand.mtl': '5d95be6531f3a23e197f1e27cbd3a2bb426e4fa198abe50ceaab9c0a20392886',
    'Model/ARC_Hand.obj': 'c17aa55587221ca6eb2d6c5fab0f6247f9c018c8f6eeb6139d5235eb6c572494',
    'Model/ARC_Target.mtl': 'c4d4bcad955b4f5842247d2ad800622e47875565a1b54df28c63865e4b4b6390',
    'Model/ARC_Target.obj': '6e1ca2ea13cec45fb1db016ef36dfec206b6a38a0179058f9acb4798d9c0d953',
    'Model/Ant_Gnd.mtl': '405e81608fdee8b6ab5d0439e0030590ee1a7eee2c57d95b995a914084dc48cf',
    'Model/Ant_Gnd.obj': '410aa6346360ea860cc8750e9257e3231c1375d233a000598c69b4f96bc7fabb',
    'Model/Ant_Isotropic.obj': '11f7b9d33c56494cc28895cfcb1278a93a17045e8ed72faf3edf1bd8f5ec7ea2',
    'Model/Ant_SBand.obj': 'd9068eae4e552526d9ad157b931d1313b7a72cafccf35c8f4024bbbc32ef6048',
    'Model/Ant_XBand.obj': '0dc17aa0fa7e4a7466a10a61e118d967a8bd13c9c9658012cdbc3418be4fead2',
    'Model/Aura_MainBody.mtl': 'cc9071f25a8ca7b2669e1ca4dddfe645138969b833c70b25a329604c2223ad59',
    'Model/Aura_MainBody.obj': '5f5ced504d359a62b0a396130dc40c8691273be48de1bfec55783c25c2ad53ae',
    'Model/Aura_SolarArray.mtl': '21db6c1f31126fcbc81537700c8a653d4226acfc383f43b9697edd6f6121e638',
    'Model/Aura_SolarArray.obj': 'a6364bdfa9fb2a5c3b6b4155a08c03024dd8d4fd7780f9e1a8597493168cc6c5',
    'Model/BBM.mtl': 'fcdbd222b1a528338e7c2fe9727a04009cdcd3cf8e9b353baa5a20b23b88013b',
    'Model/BBM.obj': '32f908ee406b580873b620ad5bcf6874330a6b69123833f1e53f5c78a656daed',
    'Model/Ball.mtl': '405e81608fdee8b6ab5d0439e0030590ee1a7eee2c57d95b995a914084dc48cf',
    'Model/Ball.obj': '6b6aa8c008d999ec11602c1aaa1c269214135ae5c5c6f08fa39da430d35f51c6',
    'Model/CMG.obj': '4d2d960e066c41e706d185de259838e6f4e56dcd377bad59cded98d2ed0a75b1',
    'Model/CMGSat_Body.obj': 'bf23e03c2f543a89d33ed07744dc73625cc9260fdaa0ce1826915a7095f2ad3c',
    'Model/Cannonball.mtl': 'ebcd4a0b009a5a61838f05d6dbaaa100b7a95ea3bfbc85d89c6413a8f50d512e',
    'Model/Cannonball.obj': '8936eed9d2c190d2ffeffc148e9c8f671c751e74d8f5cb6a2733061eb8bf891c',
    'Model/Constellations.txt': 'c741f339a0fff0470dc849ae9ec6433bf3a6f91972b6d8b6dbe224f0f072d9f2',
    'Model/Cubesat_1U.obj': '33da98c0d805a5fd2b8819a8129470a44e545ce0e0ef7d9f7b87622cc0b0c86c',
    'Model/Cubesat_3U.obj': '567eab1e6b727b94db720a692097f89b2913f80327af2b788723d9222ace81f2',
    'Model/Cubesat_6U.obj': 'a4e25d8c2bf8f3327f8548dfcedc032b35405e1b5ad685dec17a9c389509f7ba',
    'Model/EGM96.txt': '2355cc01e3b9dffc44791864a2650a3d11e35999f7fc9c447a45dfb2bc4243e4',
    'Model/Egret Source Catalog.txt': '0031a99bc167b355943e0774813acc97bf5f9864bff1c3d33d9a0451941fdf1a',
    'Model/ErosCrust03.obj': '52a9a1a4f8e3f07449f70bdd5a835b49a088709acef617195a7f1af280c60567',
    'Model/GLGM2.txt': '1086cab1f119436b395f549f41e46b16c7bca0707725295d9f2f23f33e520378',
    'Model/GMM2B.txt': 'bb335118ca5ef683cbf5954c28a16af8c40ab48f6512c790e805dae19bcafe9c',
    'Model/GenericAsteroid.obj': '870dcf4682f10ff6197501bb08d54bc910a33ed86f80b5a9645105add9ff48fd',
    'Model/HST.mtl': '4913a682c5ee232440c4f3f01f864d1cb73d5bace6f1b87ec089287e73fce96e',
    'Model/HST.obj': '75b5e72989729adc6f6571b10226afcc01590eefa09d2fe2d31558130138b7d0',
    'Model/HaideaCrust05.obj': '776938ea5d18fce4676606f48c55243926fbbd266b7f1e448f67d712cc241a5f',
    'Model/Hartley2.obj': '505ee7de2bcd8ace73a3db264eec72e5d8511b0d03977d740bb869687c5848a3',
    'Model/ISS.mtl': '653bed4722a6c721e41d40f06d4126334436470ef9b39c0600e1d60c19375651',
    'Model/ISS_HGA.obj': '90b92891f1b4f1d3dcdaebff1f3d619392daac156e3a1e55d403a9bbe9e986e4',
    'Model/ISS_MainBody.obj': '73706d862cd355785a3c1e4a5686ce18885ab3a4a149a2740a636916b6a698c3',
    'Model/ISS_Radiator.obj': 'fc075ad28d2989140e218e7dce1dfe4ccc73e4bff7e0481f7be44cb285e4f9b4',
    'Model/ISS_SimpleMainBody.mtl': 'bce206d4b59f73b43791860b67b004109f8d30d69cddafd24f96b34021743708',
    'Model/ISS_SimpleMainBody.obj': 'be6756a5d5478a464baf2d61e9f2ec06665ff7a5ae561525aa5c11353ca40cc5',
    'Model/ISS_SmSolarPanel.obj': '2b01e01abb54a668fe11a3cceb14713e1b49ff3ccee078afd1b42a10f4680c5f',
    'Model/ISS_SolarPanel.obj': '47951c6347f68a89390cabc63cc06aa99d9d3ea849e4c2bfb117f745f5283b4d',
    'Model/ISS_SolarTruss.obj': '23f1a82236405adef5515ceab4b9cf228d050636e15b01f1a308790a0dda1d14',
    'Model/IonCruiser.obj': '8c6ae5b9464668078d850253a658c97b1c62a8d08ace1e7df29e7f19090c4c04',
    'Model/ItokawaCrust03.obj': '8787c981156775acd56b461994b694319321a9b6c16e031f3c718244198aacde',
    'Model/Jnt_Passive.txt': '48e67dba4f46237ed8a56903bac4d2a718136327ef098ebc634b3abf0301e36d',
    'Model/JustACube.obj': '7e2e2d48ff546a115403fc1b6ec95ddc67f6c2563bf09a62f5963690b3563237',
    'Model/Kepler.mtl': 'c9cb7f6813909d6ca3ff5138ce4b60b71b835fe5810cae30c1e8e66340efd71c',
    'Model/Kepler.obj': 'b11cb320afecfed1c37b41b514d2dc1c28db24461296391cdd3276e40260da6c',
    'Model/Knot.obj': '7175a94681fd062e690afa47d10ff5230249a9991b45836118ad13f2ce5e38a7',
    'Model/Lacadiera.obj': '52963152c4c553a6518dc32cbde50998b6be80b686e1f4549b5d9caca9809d7a',
    'Model/LanderBody.mtl': '84db5d167ca7857b4bcef9a6b48f0ab387795573892f9880140169788cc3aed0',
    'Model/LanderBody.obj': '536637de74c834ab5bf9647bd7ba986bad217d563b76f177aad3a86f2e3a282b',
    'Model/LanderLeg.mtl': 'a9e7800e4ef027b7e3a3644ef9aae034bd26c7b6b7dc9e2cd3e7b3d5cbe1392f',
    'Model/LanderLeg.obj': '2c418d4fb87bd4f3029d4b55f542847f7d0767080c838a46df77d2011a06e525',
    'Model/MDLSat_Antenna.mtl': 'a2c06fbaaf7cbd82fd6c14a4d3cf3fb68340c947aeb430ccee7f055cfdd7e2a7',
    'Model/MDLSat_Antenna.obj': '3d1879830cb767c4065cbca75767cea46445a878ad33fec90f774e4d36159f3b',
    'Model/MDLSat_MainBody.mtl': '665604b1d36ef2b1137a9fe1ad725cd9a37ae93ae949825760aec9d021f5231d',
    'Model/MDLSat_MainBody.obj': '5ca6427ac64349f8c0999d9743410a9d3b30cb65ce799be26bc4aa856d2dd0a4',
    'Model/MDLSat_SolarArray.mtl': 'af53533c231f9e5479983eec7a9f149b43da4b27e0420f110774d2b36d17371c',
    'Model/MDLSat_SolarArray.obj': '465480765c3915ed09dff521137f684b6f637f807bd7ee6e6cc59bc7fa12aea8',
    'Model/MinorBodies.txt': 'e2774eaa02f6b63803aed73d7ce2a7d47d8afbd5e36f73e4e825ea9f46f2ca03',
    'Model/NOAA_solarflux_table.txt': '13fe08054adb8c0accd71b2972bd45d75b31ae715127287d6b7c7b2d444f9055',
    'Model/Phobos.mtl': 'd12830efd13feed418ca45f3d4f9b0788e93fe27cff7ef5b89e3a42b1c5b1c62',
    'Model/Phobos.obj': 'd224c4a2bde46495bbad9da29d96a81918d380f72e48287afd47465afd70c722',
    'Model/Point.obj': '18304f7160c579b0de60bf98e06b82cc7d4a22a527eeac70cba0c165b614cb88',
    'Model/Potato.mtl': '405e81608fdee8b6ab5d0439e0030590ee1a7eee2c57d95b995a914084dc48cf',
    'Model/Potato.obj': '22ef0ea5c5bd04dd69651af2afa30ead69112cca68472f56a2f7e2317b73f390',
    'Model/Pulsar Catalog.txt': '804326d4f9d5121f5ab6ba012a94425e15e760e9d1eaa4186ff3f860cb32b479',
    'Model/RQ36Crust05.obj': '6cc0bff3e2c25c7d49c4e7bd6d30d313b5d40da2f332886a7267775308b6846c',
    'Model/RST.obj': '4a5bd70a283910575ee1bb18c4ef76b49f540caafab8e821e6a94ee70a6e8957',
    'Model/Rgn_Crater.obj': '238843027ba2fc8909c6a6c669e3f99f067627a64ec1c088311a221df0417b06',
    'Model/Rgn_Flat.obj': '319312d9432079e5a869e078b78654b140946f36116be99b2668dbc4bdaea568',
    'Model/Rgn_MoonCrater.obj': 'dd6fa698846e2ca73bf23930db458e9f62a6e400fbee6fba57097574b93d756b',
    'Model/Rgn_TAG.obj': 'f27e71051aa6a668fceae448bf7cf6d7e84ec08600b02c89a172528165bd5216',
    'Model/Rgn_Terrain.obj': 'f9803f0b46562caab7de377657e6a2431e0bd86b994a580e1784d0d3b73f925f',
    'Model/RoverBody.obj': '01ec6fd382108bf0344d4e468b4581b81e835cc96626e9afe127ff7e1b0bdbf0',
    'Model/RoverLowerLeg.obj': 'fcff82f2ad39e8872ac7a4ab51ea573d89900fafb2417fd125bb5b6096a9fcf0',
    'Model/RoverUpperLeg.obj': '3636017eb41a0dbe0b4d6b2979dcfd8710df88b421049ce6eeb20cbac1cdf6ea',
    'Model/Skymap00.txt': '2841416afe8f173f917c100bd52608da43b4f8a626c3c21b75598906547fa051',
    'Model/Skymap01.txt': '8fced152fa711da7ecd94d4f4a7fdb49dcdd3fc44ebb0449f5b5ed35af1ddb98',
    'Model/Skymap02.txt': 'd7305467d0cae16866fd482ee16afa97e41757c7d9be072240420acf40bb63a3',
    'Model/Skymap03.txt': '67e468a19d4cd5a4a277a7334ca91ecaf14051ac140fd680758e516be713e377',
    'Model/Skymap04.txt': '40ed0310b4606b8f0fb0866824dbcd3b751a7a9980af728b0a21fcba4d7ff009',
    'Model/Skymap05.txt': '36d59de5ede7b5f0c3dbbbf23f7b5a2aaf767a2d51e2acf14dc5f43aaa5c34fe',
    'Model/Skymap06.txt': 'b843c76266f103fc4f9f9e3c96ade86b9c49bbf307a120247ceeb31702ceade0',
    'Model/Skymap07.txt': 'c634fa09aa30782b3d419ec03f8c633ac040af894d2e86c3725afbb49f487796',
    'Model/Skymap08.txt': 'a9a86d631ca8dec1bb0453bd07bc93d499f709a0517b19f8a3fbcbb106731057',
    'Model/Skymap09.txt': 'abba51a8456bd31ed26361034125ca0c3018e3df75cc7bcab12a464750776edc',
    'Model/SmallTet.mtl': 'd0f5fbba1cdf3e60337a5101b2b361bbcc333e6c8dd67734a40a8b49832304d2',
    'Model/SmallTet.obj': 'e485ec30d78e5c030e165635a6c5039956f34ac7f31f5c8e7a92f637f9552252',
    'Model/SoccerBall.mtl': '6f6255fac773d9c09dacf62b5818e06fb9d05aa69bb55f6f9ce71d7de1a279d8',
    'Model/SoccerBall.obj': '319e70379f820bfbdb76db52aa3eabc2a7082e4a096a0e3d144118d5420db66c',
    'Model/SolFlx0908_Schatten.txt': 'f4769c413ee55f9c845f82eb32462f15f9fbeafd6ef9ae30435d34cf3f096754',
    'Model/SpaceShuttleOrbiter.mtl': 'd3ddd9d802eb933512f562ba59de92d4896418c14154a0f9f5920067c09994a2',
    'Model/SpaceShuttleOrbiter.obj': 'f3a082ff5d5d737e32ff27c0cc0098c0bc10363112ac31a5acd495ccdfefec2c',
    'Model/Spectrum.txt': '3645a8913dbe98838f817b382af28c9d3ad113a92d50d8b1adfb824f52b0a575',
    'Model/Sunflower.obj': 'de2df0b94590d88fb4b3da4be604f1eb2b424a94be47d77e1c5bb5a40fc1182b',
    'Model/Telescope.mtl': '8b0ff742bab963944c351d24a86471178451befaf437ccd5d52191d8e5bff20d',
    'Model/Telescope.obj': 'ac01fd528f4295dfe1cf1a6c6d99e304036e2782ecce0dc3bfaf82f0c41d14de',
    'Model/TestSlab1.obj': '473cf6cffece8dd5af1dc9ef99314bf85f45a05bc9764ccabafdb4ecf2a97e70',
    'Model/TestSlab2.obj': '222e5a580f43755c81ebd2b2c06baea930459dfe835ef0dad35c182719be9153',
    'Model/TumbleSat0.mtl': '59965d3ed833ce21fc26fd10af7b09ca2fc805491cd00d8b430741b987674b89',
    'Model/TumbleSat0.obj': 'f7a590549042f1329f6b55f7a079f130868781fbced7cbf0eaaa8c9eba6da7c0',
    'Model/TumbleSat1.mtl': '2469847f6d9afe8585965b57d3618592a5a36f654dcb809e798ac3b6ecfdfc74',
    'Model/TumbleSat1.obj': '35350696c8369e78f2d065fefc32f5699776ad008c273a51ccd2553da6e1c3a1',
    'Model/TwoSpheres.mtl': '9d23f8883227b5939d5c6d19f234c05516936c89dccf4af4994bf0ff437d5bed',
    'Model/TwoSpheres.obj': '562844aa355ddd6becdf33372be805af47bb7ee21b4e0fadab4d4eeba0b9d52f',
    'Model/Voyager.mtl': 'b0435ea2e16129677d02f0147ef028665c2f29df79d8d8c57cbc20e37fa51fc0',
    'Model/Voyager.obj': '928abd295d6821e9b67f31199a77a4b9d045823819cc9ae0079db199a1385819',
    'Model/Wirtanen.obj': 'df5c290c807d5345e38080ee69dd419e6510effa1758bf592157ee8b7db92636',
    'Model/WirtanenEllipse.obj': '5ad6e678a226fbdc933b622334ca4665fdac18be71944d664b02a748ee27d373',
    'Model/ae8max.txt': '73cf3ad873c8adea48c27eb7628621a03937d9f6c17b55805d32692e636815e8',
    'Model/ae8min.txt': '4cea68a560a98e3efab4ec3b02a78a026c077453f179606a9a598698cfa34734',
    'Model/ap8max.txt': 'e21fced8e9c2e97d6bf4824173bed1af803b9f52ca261c49106b0c58e609a7de',
    'Model/ap8min.txt': 'e381b3aaa88a120e6ee9e8cc0645d0205ca947924d2bf32e86a105044749ebf8',
    'Model/igrf00.txt': '7116315e802dfd1d47c732fb5d75d8068f0c59d1a16ece6b81b270575c480383',
    'Model/igrf05.txt': '5043094a0483d9499a3ec6352ce1f3ba165a3f74e7b81347c1cadf735ab0cf6e',
    'Model/igrf10.txt': '2b65b4bc099734c4ecf176c007ad572ceda246f889eda3f41a8558e065edc581',
    'Model/igrf15.txt': 'c2c340e4be5085d22e61ad870250792adf4011810faa6b7c2af1bf297876e5f1',
    'Model/igrf20.txt': '58d8124807302d550ecc2760feebd9705ea2e6ecad91da9d6706b22f89dbc5e5',
    'Model/igrf95.txt': '758da834fc52e0dfc89961e62bf333b8e03f7a601d73637566fa07d7a9dd9077',
    'Model/moai.obj': '0386c0e8e6c181a038943f5c594fa8bc5b2b33ac5f4b4efc2a101d24d907ad44',
    'Model/stf1_red.obj': '51e4090af4fa8638e2354d6aec31752845a4fcf0561725636d122ed4598d5fd6',
    'World/AlbedoToCube.c': 'a8ecdbc4bce160816d9b49a72a87723d856f333434c966a4827faf7e7b5e81cc',
    'World/Asteroid_KepEl.txt': 'f2526b2257b23f563949b325b9c2245b5e2050392f1a627dfd8416b7302a64ec',
    'World/DEMToBumpCube.c': '28227ad7802ce0517cb76d78e66f19e416eadeba0a7162103f813cc100822c94',
    'World/Downing Models/gravity/amalthea/amalthea6x6.cof': 'b4d8aa990353eaa120cf58236a0014448847db9b78f4d87d31b3c4410aa7d190',
    'World/Downing Models/gravity/callisto/callisto2x2.cof': '95576d7f5d84be4b216f51aa07146dd20fa8366dc31c642f668bc7c0a2465263',
    'World/Downing Models/gravity/earth/dbs_earth50.pc': 'e5c51555fd6d3fa787a39798c27ec4c904dcf297766972f44a09b398053f9b29',
    'World/Downing Models/gravity/earth/egm96_360x360.cof': '792bbeb1c59eda8f2773970e66c425de2286edb3e4596ab42bc4cb50b20ce2f6',
    'World/Downing Models/gravity/earth/gemt1.cof': 'ca77daf1b0c9e631e699f9e0450990863ba9370fe95ad673800284ace328fb27',
    'World/Downing Models/gravity/earth/grv-files/egm96.grv': '88d4b636d59c53abd4e99d3365f83ba52dea69bc2ac7252a99c06ccc7ff92a78',
    'World/Downing Models/gravity/earth/grv-files/gemt1.grv': 'fe83291cd729e54b9343d7b706268cf50786a9c0bd6814635b497273fcb949b0',
    'World/Downing Models/gravity/earth/grv-files/jgm2.grv': 'a0d642cf85a2134cde1881c305e5017e70f68f7c6da4e050f071fa4ac8487b23',
    'World/Downing Models/gravity/earth/grv-files/jgm3.grv': 'c6ee21bc8eb2285c407a77924583709970aba2e3d7f098a9247116165313d4f1',
    'World/Downing Models/gravity/earth/grv-files/wgs84.grv': '73bc76af2a9b4f69a5d5eb955108c13eb7a417656c281ac41e8875a6f8eea066',
    'World/Downing Models/gravity/earth/grv-files/wgs84_egm96.grv': 'b6ea1269bfa96cba8bdc3008f9e955a5bb98b369758eb08f826fca3dc7012d3a',
    'World/Downing Models/gravity/earth/grv-files/wgs84_old.grv': '016153d4f54f73340ed6a3bce836506568648e46dea9c84526134f611eabefa8',
    'World/Downing Models/gravity/earth/jgm2.cof': 'b44a3a5563b1d04409f034f984d0d116a72ded3e5915eb8a998bbb25eb95b4a3',
    'World/Downing Models/gravity/earth/jgm2f70.cof': 'fb6b448f03a86c660e6ddd6fcc73a1abb5f94b77f6d2dae68aa722c42a47aee9',
    'World/Downing Models/gravity/earth/jgm3.cof': 'a28d6ec113dfb829b970a139718531846849e08931d4cc49c3207dc60f35e3f3',
    'World/Downing Models/gravity/earth/readme/dbs_earthfld.txt': 'e0e3cf1921d5ba0c069cf46566b522adf68863a71067e8f9b3cc3995fb912e95',
    'World/Downing Models/gravity/earth/readme/readme.egm96': 'ba34e0e1c84b1135aedf4cc88a748bfdd43fee15ba86091680382d822f5a97a2',
    'World/Downing Models/gravity/earth/wgs84.cof': '1df41e08e92e6c6acfd1b15bfe734ce462003e007a3388c9a43daa4e68447e5a',
    'World/Downing Models/gravity/eros/eros15x15.cof': '1d0183ec9f2066094bba448a2cdb82a7b574576eb869fcdb01f32ccaac268ebe',
    'World/Downing Models/gravity/eros/readme/n15acoeff.lbl': '55b98e41e460e77862ff69f5601b1a2f650ef37d94ed899f90918e8fff9d9353',
    'World/Downing Models/gravity/europa/europa2x2.cof': '954e914587c07556a65a07928a24626d1b6248bb77be64cc8fc510428172c855',
    'World/Downing Models/gravity/ganymede/ganymede2x2.cof': '22a3b8c619f759d86bd5d2241eb8337d5d651ba536b6c40fc8fb8b15cc8b57c8',
    'World/Downing Models/gravity/io/io2x2.cof': '3ea1e323e7fc657ec06815569a4dcf87138f5a344bcdfa4c91c50bcc2d596632',
    'World/Downing Models/gravity/jupiter/jupiter6x2.cof': 'f325c347c419d83da438cd884ca4f7967a0357ad1bdef39c098ee179515df156',
    'World/Downing Models/gravity/mars/gmm1.cof': 'dea832f12608ed2cfe8eb1f43d729be8d343759f52861bcbf3bbc788986dddbf',
    'World/Downing Models/gravity/mars/gmm2b.cof': '8a36f63e6a2e3d8f1c60db1ba9f875754913ccc81e9819382e77d34a62efb51f',
    'World/Downing Models/gravity/mars/grv-files/gmm1.grv': 'e661e664e5e3aaa2f2ddf6f09feeab71e4374384a3331769de9a608b8623363e',
    'World/Downing Models/gravity/mars/grv-files/gmm2b.grv': 'b521de69345b84e9ed9a370e2d9a0915003b9b17d31f57eb70f4fd692d36c47c',
    'World/Downing Models/gravity/mars/grv-files/mars50c.grv': 'af7f870fb60444ac2f62c46ebbd740f755729bc2f8a2e12ecd2665d17cddf30e',
    'World/Downing Models/gravity/mars/mars50c.cof': '33d91340903330b235e675c3d632b3a3d3d224557c9ccc9a24054d32ed404583',
    'World/Downing Models/gravity/mercury/mercury2x0.cof': 'b972066b237a8dd367884517979a730e5d1d7b6e392445161db056377216e9e1',
    'World/Downing Models/gravity/moon/dbs_lunarfld.pc': 'a9aa43586c10d729e547b69cb6ec0cca7dce09cea16b9b7974a95450ff9dcb30',
    'World/Downing Models/gravity/moon/glgm2.cof': '72c73839b8f4defffc5089c1457ab9e74d48f91e004a746236440a13150eaa5e',
    'World/Downing Models/gravity/moon/hold/lp165p.grv': 'e834cb6386d0b06acb82a2ffed5a93e4c271a34fb9bf056f9e0bed21e55f2fe2',
    'World/Downing Models/gravity/moon/hold/moon4x3.cof': '9ef767f55102c918bb439b7d363ccca3e212dde8223d79976161419374c66c8f',
    'World/Downing Models/gravity/moon/hold/moon5x5.cof': '4388a5b8516f07f6505d5e2dc709de5cb93bd8c161f8a13544d5f2f4738970da',
    'World/Downing Models/gravity/moon/larc.cof': '2ae46ff3980a04d7af1a631e4c266a2842734eed6048c3e6181f8f9a7553eed1',
    'World/Downing Models/gravity/moon/lp100j.cof': '3518ede7b59a335fa564680ef7d33aae92ed040fd68aa42d4a8513719204aa60',
    'World/Downing Models/gravity/moon/lp165p.cof': 'b129a334dfeb0157d455cf01f241dd6cefb6bdebea9c635e36c1e7c0d4a44158',
    'World/Downing Models/gravity/moon/lp75amod.cof': '6c9c4fe7f44009948b23a38f5cd4ba208c63cfd37d48b4508a1d1d41430e198f',
    'World/Downing Models/gravity/moon/lun50g.cof': '9ac3e677e4b94b271219c35d9d150232824b34a26dcfd4f2f79baa6a9aa1ddb8',
    'World/Downing Models/gravity/moon/lun75a-trun.cof': '22a0d9abaab83941c5bc40fe6d2b8f73ff658296cf56f3d48448b67d54c59c11',
    'World/Downing Models/gravity/moon/lunarmanned.cof': 'c1f43e825113e446587fc108c61adc75baa61e1b9a3c15bbe2773fc1c5be4e53',
    'World/Downing Models/gravity/moon/moon16x16.cof': 'af155910a17445f38008ecb3d22a88a72bda8aaac2bf5151b45c552459194316',
    'World/Downing Models/gravity/moon/moonjpl.cof': 'ab62a3d29f349e31d4d3292c9aa20623cf94a0ec9d8c1f42e954f4ec913e935b',
    'World/Downing Models/gravity/moon/sha-files/jgl075d1.lbl': '13440a6f48940a6c32fa56205bd3e1dfcb4c21670b40b8f39cf46cb56aac7169',
    'World/Downing Models/gravity/moon/sha-files/jgl075d1.sha': '0020bd84233e1f8c2be7936cc4e2e5267acb2e43f1619fab8de615a4902d0113',
    'World/Downing Models/gravity/moon/sha-files/jgl075g1.lbl': '72f385b56e2a3e0201c2f72d86f3e1b9676924e34441a11896bf3cebc1d055be',
    'World/Downing Models/gravity/moon/sha-files/jgl075g1.sha': 'a02d32b0ee433d8551e9addd88829667df6cb496914e539fae3a15b7916bc7d0',
    'World/Downing Models/gravity/moon/sha-files/jgl100j1.lbl': 'aa63c9966ec57ab355d74c88f2b3dde32a133125fd1e550d40bbca7b21416e86',
    'World/Downing Models/gravity/moon/sha-files/jgl100j1.sha': '991cab7bfd07c25ae2d9c6ed3c90a9825f416938b09995d59d6f4d9c38b53284',
    'World/Downing Models/gravity/moon/sha-files/jgl100k1.lbl': 'd67a90e44852cf802ab1ab77cda16764e7b4081afded4bc3580115141078ce8c',
    'World/Downing Models/gravity/moon/sha-files/jgl100k1.sha': '97ab5799c8d7bee5e26d051554d663ddb3ce14b9621df4255b5cfdb63428b238',
    'World/Downing Models/gravity/moon/sha-files/jgl150q1.lbl': '0c161868753f98b4d4e778f91f3a6d6613c8937b13a39afcd54214a2b767b357',
    'World/Downing Models/gravity/moon/sha-files/jgl150q1.sha': '61dd4f9bcbfe5552171395d56d91f6e3c8bf63cfc2f57d387f203357e2003514',
    'World/Downing Models/gravity/moon/sha-files/jgl165p1.lbl': 'a1d88fec0d2628b1d4ea269aa98f97bff9877a2e5130e23b0c102be81429097e',
    'World/Downing Models/gravity/moon/sha-files/jgl165p1.sha': 'b75a40be56f9b58bd00536a65c7773db3b6ed17de78fba26b945837fd0d049ee',
    'World/Downing Models/gravity/neptune/neptune4x0.cof': 'c193d38b410ff8ebba55fa960484eb082f4ec74b65ac75a0b12941b9b923569b',
    'World/Downing Models/gravity/saturn/saturn8x0.cof': '33ac8434bb795f4ed78b4036f2f5520dc000ba4e5370b9908b576e20624b85c2',
    'World/Downing Models/gravity/uranus/uranus4x0.cof': 'f6f5d5d92602b04cc852651922e50f4aaee822ce12029a801b0309c3039e21ef',
    'World/Downing Models/gravity/venus/grv-files/mgnp180u.grv': 'd4edf36ae5bfe6747f71701b8e59b5dea94a3242e7cdbff6b9cc65717ff5d9e7',
    'World/Downing Models/gravity/venus/mgn75hsaap.cof': 'a59480e1e0911a8c3c7fe8daa68f1311426bb1a0f5778d31b5f95a7961a07e68',
    'World/Downing Models/gravity/venus/mgnp180u.cof': 'd92ab8295184e08c71c631e25041c37301d09229bfa6a2f076dc23ea842adbb8',
    'World/Downing Models/gravity/venus/readme/venus-shg120.tab': 'b97d21d89041e9f94f210e1063b535cfffef4917f037d62bdeebdb5466f82ddc',
    'World/Downing Models/gravity/venus/shg120.cof': '5d76e1b0c6b658c87e0bf6cb45ccb08929d473f7f83574196a6d06f563955ab1',
    'World/Downing Models/val_atm_hp.cpp': '9eb2386f62dda16b46b80ea842bd9202b980eee34fb29d40965b6f5ef87f3299',
    'World/Downing Models/val_atm_hp.h': 'a3525f450d079a10b798346c5ec36268a1ec4a03ca0edd0bd4f7a209b3a9d21e',
    'World/Downing Models/val_atm_jr.cpp': '308c28469a71dd4545aa139b579c8286c0897b59eeaef5f6843736362579eb23',
    'World/Downing Models/val_atm_jr.h': 'b5bfe283a7e93ce3589c6508837089ad7616499177a489ca966ad8f80e8faa59',
    'World/Downing Models/val_atm_msis00.cpp': 'cfb265226d7b5167980343c7a014659f6881e0655703c2db76ae8f5a6e1ddc21',
    'World/Downing Models/val_atm_msis00.h': '3a4f4761dbab7f93400097fc0beef73515dbbe19ab2bcf4d82f8e10734e7777c',
    'World/Downing Models/val_atm_msis86.cpp': '77a1a8592b51fe2858e92f567536688bc9ba75b5b5e64571caf8ff3463b3a654',
    'World/Downing Models/val_atm_msis86.h': 'e91c84c67c0879c287a43fa0915157ac30d52d7f5fb85c708c0dad64fc7dc49b',
    'World/Downing Models/val_atm_msis90.cpp': '1ff439c36bb3a80bd95395f3cc7e61b7dfff53127dfa5af9896422d535fcea57',
    'World/Downing Models/val_atm_msis90.h': '1d4fbf2d069c96bf12e1fb72b88e4cc6216349a861d5b2d3cc00524d2ba5fac6',
    'World/Downing Models/val_atm_vts3.cpp': 'e3fe45caa5b741485807f9a69e590f639ec2486f46ada32fdb146dbf6b55c730',
    'World/Downing Models/val_atm_vts3.h': 'dd834b9962dfde02a1a919367963cba0a7faec0519296d45ae481007b47164e3',
    'World/MercatorToCube.c': '19a15078a1703341538e2ed0d41ae934971118456f5d69596aff8751c678c017',
    'World/MercatorToCube.dSYM/Contents/Info.plist': 'aef49d0336c9d66be4ad7043d39670dca2508adb3110b2cfec47b60888207934',
    'World/Planet Maps/JPL/ReadMe.txt': '86e7ce088fd688f678e431593f701ea82da8f27208addc579e4d04b2a98aa452',
    'World/PlanetAxes.txt': '7e08972e20bff1e5fcb96966e85b55137b979500e628fa2ae30be0dc887bf26c',
    'World/WhiteBallToCube.c': '6165d4d1ef93ff03357c63e0ebe37ee50f90d1ea478da15429936e7e3dcf8528',
}
EXPECTED_ASSET_TREE_SHA256 = 'd7d68ea74816d4c0bd78120adf02a982832727d34806c210b7b693f0028a8c48'

EXPECTED_SOURCE_REVISION = 'dev_20260403'
JOB_ID = re.compile(r'^orbit42_[a-f0-9]{32}$')
HASH = re.compile(r'^[a-f0-9]{64}$')
ACTIVE = None


def digest(data):
    return hashlib.sha256(data).hexdigest()


def finite(value, low, high, name):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
        raise ValueError(f'{name} must be finite in [{low}, {high}]')
    return float(value)


def fail_if_extra(value, allowed, label):
    extra = set(value) - set(allowed)
    if extra:
        raise ValueError(f'Unknown {label} fields: {sorted(extra)}')


def read_request():
    data = sys.stdin.buffer.read(131073)
    if len(data) > 131072:
        raise ValueError('Orbit request exceeds 128 KiB')
    request = json.loads(data)
    if not isinstance(request, dict):
        raise ValueError('Orbit request must be an object')
    fail_if_extra(request, {'jobId', 'inputHash', 'sourceFile'}, 'request')
    job_id = request.get('jobId')
    if not isinstance(job_id, str) or not JOB_ID.fullmatch(job_id):
        raise ValueError('Invalid orbit job ID')
    source = request.get('sourceFile')
    if not isinstance(source, dict):
        raise ValueError('A pinned .orbit42.json model is required')
    fail_if_extra(source, {'path', 'content', 'sha256'}, 'source')
    name = source.get('path')
    content = source.get('content')
    if not isinstance(name, str) or not name.endswith('.orbit42.json') or len(name) > 240 or name.startswith('/') or '\\' in name or any(part in ('', '.', '..') or part.startswith('.') for part in name.split('/')):
        raise ValueError('Invalid project-relative orbit model path')
    if not isinstance(content, str) or len(content.encode()) > 65536:
        raise ValueError('Orbit model must contain at most 64 KiB UTF-8')
    source_hash = digest(content.encode())
    if source.get('sha256') != source_hash or request.get('inputHash') != source_hash:
        raise ValueError('Pinned orbit model hash mismatch')
    model = json.loads(content)
    if not isinstance(model, dict) or model.get('schema') != 'manta-orbit42-v1':
        raise ValueError('Expected manta-orbit42-v1 model')
    fail_if_extra(model, {'schema', 'scenario', 'source', 'assumptions'}, 'model')
    if model.get('source') != {'repository': 'nasa-itc/42', 'revision': EXPECTED_SOURCE_REVISION}:
        raise ValueError('Orbit model must declare the pinned native 42 source revision')
    scenario = model.get('scenario')
    if not isinstance(scenario, dict):
        raise ValueError('scenario must be an object')
    keys = {'epochUtc', 'leapSeconds', 'periapsisAltitudeKm', 'apoapsisAltitudeKm',
            'inclinationDeg', 'raanDeg', 'argumentOfPeriapsisDeg', 'trueAnomalyDeg',
            'durationSeconds', 'stepSeconds', 'outputIntervalSeconds'}
    if set(scenario) != keys:
        raise ValueError('Scenario requires explicit UTC, leap-second, orbital element and bounded run settings')
    epoch = scenario['epochUtc']
    if not isinstance(epoch, str) or not re.fullmatch(r'20\d\d-\d\d-\d\dT\d\d:\d\d:\d\dZ', epoch):
        raise ValueError('epochUtc must be an explicit whole-second UTC timestamp')
    parsed = dt.datetime.strptime(epoch, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=dt.timezone.utc)
    if not 2000 <= parsed.year <= 2040:
        raise ValueError('UTC epoch must be in 2000–2040 for this bounded recipe')
    leap = finite(scenario['leapSeconds'], 0, 100, 'leapSeconds')
    if not leap.is_integer():
        raise ValueError('leapSeconds must be an integer assumption')
    peri = finite(scenario['periapsisAltitudeKm'], 150, 2000, 'periapsisAltitudeKm')
    apo = finite(scenario['apoapsisAltitudeKm'], peri, 2000, 'apoapsisAltitudeKm')
    for field, lower, upper in [
        ('inclinationDeg', 0, 180), ('raanDeg', 0, 360),
        ('argumentOfPeriapsisDeg', 0, 360), ('trueAnomalyDeg', 0, 360)]:
        finite(scenario[field], lower, upper, field)
    duration = finite(scenario['durationSeconds'], 60, 2000, 'durationSeconds')
    # The pinned 42 SC_Simple input contains 0.1-second sensor sample times.
    # A coarser dynamics step causes native 42 to reject the scenario.
    step = finite(scenario['stepSeconds'], 0.01, 0.1, 'stepSeconds')
    output = finite(scenario['outputIntervalSeconds'], step, 300, 'outputIntervalSeconds')
    if duration / step > 20000 or duration / output > 2000 or abs(round(output / step) - output / step) > 1e-9:
        raise ValueError('42 run exceeds step/output bounds or output interval is not a step multiple')
    if not isinstance(model.get('assumptions'), list) or len(model['assumptions']) > 20 or any(not isinstance(v, str) or len(v) > 500 for v in model['assumptions']):
        raise ValueError('Declare 0–20 concise assumptions')
    return request, model, parsed


def replace_line(text, pattern, value, label):
    updated, count = re.subn(pattern, lambda m: value + m.group(1), text, count=1, flags=re.M)
    if count != 1:
        raise ValueError(f'Pinned 42 template field missing: {label}')
    return updated


def verified_templates(source_dir, expected=EXPECTED_TEMPLATE_SHA256):
    if source_dir.is_symlink() or not source_dir.is_dir():
        raise ValueError('Pinned 42 template directory is missing or linked')
    candidates = {item.name: item for item in source_dir.iterdir() if item.name.endswith('.txt')}
    if set(candidates) != set(expected):
        raise ValueError('Pinned 42 input template inventory mismatch')
    verified = []
    for name in sorted(expected):
        item = candidates[name]
        st = item.lstat()
        if not stat.S_ISREG(st.st_mode) or st.st_size > 2_000_000:
            raise ValueError('Unexpected 42 input template type or size: ' + name)
        content = item.read_bytes()
        actual = digest(content)
        if actual != expected[name] or len(content) != st.st_size:
            raise ValueError('Pinned 42 input template hash mismatch: ' + name)
        verified.append((name, content, actual))
    return verified


def verified_assets(root=pathlib.Path('/srv/manta/42-assets'), expected=EXPECTED_ASSET_SHA256):
    if root.is_symlink() or not root.is_dir():
        raise ValueError('Pinned 42 asset root is missing or linked')
    found = set()
    for folder_name in ('Model', 'World'):
        folder = root / folder_name
        if folder.is_symlink() or not folder.is_dir():
            raise ValueError('Pinned 42 asset directory missing or linked: ' + folder_name)
        if root == pathlib.Path('/srv/manta/42-assets') and (SOURCE / folder_name).resolve() != folder.resolve():
            raise ValueError('Native 42 asset directory does not resolve to private reviewed assets')
        for item in folder.rglob('*'):
            kind = item.lstat().st_mode
            if stat.S_ISDIR(kind):
                continue
            if not stat.S_ISREG(kind):
                raise ValueError('Unexpected 42 asset file type: ' + str(item))
            found.add(item.relative_to(root).as_posix())
            if len(found) > 500:
                raise ValueError('42 asset inventory exceeds the reviewed bound')
    if found != set(expected):
        raise ValueError('Pinned 42 Model/World asset inventory mismatch')
    observed = {}
    for name in sorted(expected):
        target = root / name
        descriptor = os.open(target, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
        try:
            before = os.fstat(descriptor)
            if not stat.S_ISREG(before.st_mode) or before.st_size > 32 * 1024 * 1024:
                raise ValueError('Pinned 42 asset type or size mismatch: ' + name)
            hasher = hashlib.sha256()
            with os.fdopen(descriptor, 'rb', closefd=False) as handle:
                for chunk in iter(lambda: handle.read(1024 * 1024), b''):
                    hasher.update(chunk)
            after = os.fstat(descriptor)
            if before.st_ino != after.st_ino or before.st_size != after.st_size or before.st_mtime_ns != after.st_mtime_ns:
                raise ValueError('Pinned 42 asset changed while being verified: ' + name)
            observed[name] = hasher.hexdigest()
            if observed[name] != expected[name]:
                raise ValueError('Pinned 42 asset hash mismatch: ' + name)
        finally:
            os.close(descriptor)
    tree_hash = digest(json.dumps(observed, sort_keys=True, separators=(',', ':')).encode())
    if expected is EXPECTED_ASSET_SHA256 and tree_hash != EXPECTED_ASSET_TREE_SHA256:
        raise ValueError('Pinned 42 asset-tree digest mismatch')
    return {'fileCount': len(observed), 'treeSha256': tree_hash,
            'sourceIntegritySha256': 'fadfb8bd140f81a0488f4668ccb4e19f785bf12349fe42dcf872856ebf1c485d',
            'assetManifestSha256': 'de831c50047b3376e1fb5400bf062fc197b5edd536266a91172080ad3af19a61'}


def prepare_inputs(work, model, epoch):
    source_dir = SOURCE / 'InOut'
    templates = verified_templates(source_dir)
    target = work / 'InOut'
    target.mkdir()
    template_hashes = []
    for name, content, original_hash in templates:
        (target / name).write_bytes(content)
        template_hashes.append({'path': name, 'sha256': original_hash})
    sc = model['scenario']
    sim_path = target / 'Inp_Sim.txt'
    text = sim_path.read_text()
    edits = [
        (r'^FAST(?=\s*!\s*Time Mode)([^\n]*)$', 'FAST', 'time mode'),
        (r'^10000\.0\s+0\.1(?=\s*!\s*Sim Duration)([^\n]*)$', f"{sc['durationSeconds']} {sc['stepSeconds']}", 'duration/step'),
        (r'^10\.0(?=\s*!\s*File Output Interval)([^\n]*)$', str(sc['outputIntervalSeconds']), 'output interval'),
        (r'^TRUE(?=\s*!\s*Graphics Front End\?)([^\n]*)$', 'FALSE', 'headless mode'),
        (r'^04\s+08\s+2024(?=\s*!\s*Date \(UTC\))([^\n]*)$', f'{epoch.month:02} {epoch.day:02} {epoch.year}', 'UTC date'),
        (r'^00\s+00\s+0\.00(?=\s*!\s*Time \(UTC\))([^\n]*)$', f'{epoch.hour:02} {epoch.minute:02} {epoch.second:.2f}', 'UTC time'),
        (r'^37\.0(?=\s*!\s*Leap Seconds)([^\n]*)$', str(int(sc['leapSeconds'])), 'leap seconds'),
    ]
    for pattern, value, label in edits:
        text = replace_line(text, pattern, value, label)
    sim_path.write_text(text)
    orbit_path = target / 'Orb_LEO.txt'
    text = orbit_path.read_text()
    orbit_edits = [
        (r'^400\.0\s+400\.0(?=\s*!\s*Periapsis & Apoapsis Altitude)([^\n]*)$', f"{sc['periapsisAltitudeKm']} {sc['apoapsisAltitudeKm']}", 'periapsis/apoapsis'),
        (r'^52\.0(?=\s*!\s*Inclination)([^\n]*)$', str(sc['inclinationDeg']), 'inclination'),
        (r'^0\.0(?=\s*!\s*Right Ascension of Ascending Node)([^\n]*)$', str(sc['raanDeg']), 'RAAN'),
        (r'^0\.0(?=\s*!\s*Argument of Periapsis)([^\n]*)$', str(sc['argumentOfPeriapsisDeg']), 'argument of periapsis'),
        (r'^20\.0(?=\s*!\s*True Anomaly)([^\n]*)$', str(sc['trueAnomalyDeg']), 'true anomaly'),
    ]
    for pattern, value, label in orbit_edits:
        text = replace_line(text, pattern, value, label)
    orbit_path.write_text(text)
    return template_hashes


def limits():
    resource.setrlimit(resource.RLIMIT_AS, (2 * 1024 ** 3, 2 * 1024 ** 3))
    resource.setrlimit(resource.RLIMIT_CPU, (90, 90))
    resource.setrlimit(resource.RLIMIT_FSIZE, (32 * 1024 ** 2, 32 * 1024 ** 2))
    resource.setrlimit(resource.RLIMIT_NOFILE, (128, 128))


def native_args(work):
    args = ['/usr/bin/bwrap', '--unshare-all', '--die-with-parent', '--new-session']
    for mount in ('/usr', '/bin', '/lib', '/lib64', '/etc'):
        if pathlib.Path(mount).exists():
            args += ['--ro-bind', mount, mount]
    args += ['--dev', '/dev', '--proc', '/proc', '--tmpfs', '/tmp',
             '--ro-bind', str(SOURCE), str(SOURCE),
             '--ro-bind', '/srv/manta/42-assets', '/srv/manta/42-assets',
             '--bind', str(work), '/work', '--chdir', '/work',
             '--clearenv', '--setenv', 'PATH', '/usr/bin:/bin',
             '--setenv', 'HOME', '/tmp', '--setenv', 'LANG', 'C.UTF-8',
             str(BINARY), '/work/InOut', str(SOURCE / 'Model')]
    return args


def rows(file, count):
    raw = file.read_text().splitlines()
    if len(raw) != count:
        raise ValueError(f'42 {file.name} row count mismatch')
    parsed = []
    for line in raw:
        values = [float(v) for v in line.split()]
        if len(values) != 9 or not all(math.isfinite(v) for v in values):
            raise ValueError(f'42 {file.name} row is not nine finite N-frame values')
        parsed.append(values)
    return parsed


def world_rows(file, count):
    raw = file.read_text().splitlines()
    if len(raw) != count:
        raise ValueError(f'42 {file.name} row count mismatch')
    parsed = []
    for line in raw:
        values = [float(v) for v in line.split()]
        if len(values) != 3 or not all(math.isfinite(v) for v in values):
            raise ValueError(f'42 {file.name} row is not three finite W-frame values')
        parsed.append(values)
    return parsed


def convert(work, model):
    output = work / 'InOut'
    times = [float(v) for v in (output / 'time.42').read_text().splitlines()]
    if not 2 <= len(times) <= 2001 or not all(math.isfinite(v) for v in times):
        raise ValueError('42 time output is absent or unbounded')
    if abs(times[0]) > 1e-6 or any(b <= a for a, b in zip(times, times[1:])):
        raise ValueError('42 time output is not monotonic from zero')
    duration = model['scenario']['durationSeconds']
    if abs(times[-1] - duration) > max(model['scenario']['stepSeconds'], 1):
        raise ValueError('42 did not reach the requested final time')
    positions = rows(output / 'PosN.42', len(times))
    velocities = rows(output / 'VelN.42', len(times))
    world_positions = world_rows(output / 'PosW.42', len(times))
    destination = work / 'trajectory.csv'
    with destination.open('w', newline='') as handle:
        writer = csv.writer(handle)
        writer.writerow(['time_seconds', 'x_n_m', 'y_n_m', 'z_n_m', 'vx_n_mps', 'vy_n_mps', 'vz_n_mps'])
        for t, position, velocity in zip(times, positions, velocities):
            writer.writerow([t, *position[:3], *velocity[:3]])
    radii = [math.hypot(*p[:3]) for p in positions]
    world_radii = [math.hypot(*p) for p in world_positions]
    radius_differences = [abs(n - w) for n, w in zip(radii, world_radii)]
    speeds = [math.hypot(*v[:3]) for v in velocities]
    checks = [
        {'id': 'native-output-present', 'passed': len(times) >= 2, 'actual': len(times)},
        {'id': 'monotonic-simulation-time', 'passed': True, 'actual': [times[0], times[-1]]},
        {'id': 'bounded-radius', 'passed': min(radii) > 6_378_000 and max(radii) < 50_000_000,
         'actual': [min(radii), max(radii)], 'unit': 'm'},
        {'id': 'bounded-native-world-radius', 'passed': min(world_radii) > 6_378_000 and max(world_radii) < 50_000_000,
         'actual': [min(world_radii), max(world_radii)], 'unit': 'm'},
        {'id': 'native-n-to-w-radius-invariance', 'passed': max(radius_differences) <= 15.0,
         'actual': max(radius_differences), 'tolerance': 15.0, 'unit': 'm',
         'note': 'PosN.42 uses native %le output precision; this is a coarse frame-consistency diagnostic'},
        {'id': 'bounded-speed', 'passed': min(speeds) > 100 and max(speeds) < 20_000,
         'actual': [min(speeds), max(speeds)], 'unit': 'm/s'},
    ]
    return {'samples': len(times), 'startSeconds': times[0], 'stopSeconds': times[-1],
            'radiusRangeM': [min(radii), max(radii)], 'speedRangeMps': [min(speeds), max(speeds)],
            'checks': checks}


def exported(file, name, mime):
    data = file.read_bytes()
    if len(data) > 12 * 1024 * 1024:
        raise ValueError('42 output file exceeds 12 MiB export bound')
    return {'path': name, 'sha256': digest(data), 'mimeType': mime, 'contentBase64': base64.b64encode(data).decode()}


def run(request, model, epoch):
    global ACTIVE
    JOBS.mkdir(parents=True, exist_ok=True, mode=0o700)
    if JOBS.is_symlink():
        raise ValueError('Orbit job root cannot be a symlink')
    job_id = request['jobId']
    directory = JOBS / job_id
    if directory.exists():
        raise ValueError('Orbit job ID already exists; submit a new immutable run')
    directory.mkdir(mode=0o700)
    work = directory / 'work'
    work.mkdir()
    (directory / 'input.json').write_text(json.dumps(request, indent=2))
    started = dt.datetime.now(dt.timezone.utc).isoformat()
    clock = time.monotonic()
    source_hash = digest(pathlib.Path(__file__).read_bytes())
    binary_hash = digest(BINARY.read_bytes())
    if binary_hash != EXPECTED_BINARY_SHA256:
        raise ValueError('Installed native 42 binary differs from pinned reviewed build')
    asset_receipt = verified_assets()
    template_hashes = prepare_inputs(work, model, epoch)
    command = native_args(work)
    log = directory / 'native-42.log'
    code = -1
    with log.open('wb') as handle:
        ACTIVE = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=handle,
                                  stderr=subprocess.STDOUT, start_new_session=True,
                                  env={'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'}, preexec_fn=limits)
        (directory / 'process.json').write_text(json.dumps({'jobId': job_id, 'pid': ACTIVE.pid}))
        try:
            code = ACTIVE.wait(timeout=90)
        except subprocess.TimeoutExpired:
            os.killpg(ACTIVE.pid, signal.SIGKILL)
            ACTIVE.wait()
            raise RuntimeError('Native 42 exceeded 90-second wall-time bound')
        finally:
            (directory / 'process.json').unlink(missing_ok=True)
            ACTIVE = None
    if code:
        raise RuntimeError('Native 42 failed: ' + log.read_text(errors='replace')[-3000:])
    metrics = convert(work, model)
    success = all(check['passed'] for check in metrics['checks'])
    scope = 'Native 42 short-run reference-orbit dynamics, not mission coverage or system acceptance'
    receipt = {
        'schema': 'manta-orbit42-receipt-v1', 'jobId': job_id, 'inputHash': request['inputHash'],
        'sourceFile': {'path': request['sourceFile']['path'], 'sha256': request['sourceFile']['sha256']},
        'tool': {'id': 'nasa-42', 'repository': 'nasa-itc/42', 'revision': EXPECTED_SOURCE_REVISION,
                 'binarySha256': binary_hash}, 'adapterSha256': source_hash,
        'templateFiles': template_hashes,
        'assets': asset_receipt,
        'modifiedInputs': [
            {'path': name, 'sha256': digest((work / 'InOut' / name).read_bytes())}
            for name in ('Inp_Sim.txt', 'Orb_LEO.txt')],
        'rawOutputs': [
            {'path': name, 'sha256': digest((work / 'InOut' / name).read_bytes())}
            for name in ('time.42', 'PosN.42', 'VelN.42', 'PosW.42')],
        'frame': '42 Earth-centered N frame; not asserted to be a certified J2000/ITRF transformation',
        'worldFrame': '42 native Earth rotating W frame: Source/42report.c lines 426-429 applies World.CWN to spacecraft PosN; 42sensors.c lines 391-392 uses ECEFToWGS84 on GPS.PosW. This is not a certified ITRF transformation.',
        'epochUtc': model['scenario']['epochUtc'],
        'leapSecondsAssumed': model['scenario']['leapSeconds'],
        'timeScale': 'simulation seconds from declared epochUtc; leapSeconds is supplied by the model',
        'units': {'position': 'm', 'velocity': 'm/s', 'time': 's'},
        'isolation': 'Linux VM and bubblewrap --unshare-all, no network or host/global dependency installation',
        'startedAt': started, 'finishedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
        'wallSeconds': time.monotonic() - clock, 'scope': scope,
        'pending': ['independent orbit validation', 'coordinate-frame conversion to GIS data',
                    'field of view/ground footprint', 'revisit and three-month mission duration',
                    'ground station contact and 24-hour delivery', 'hardware and environmental qualification'],
    }
    report = (
        '# Native 42 orbit study\n\n'
        f"- Job: `{job_id}`\n- Source: `{request['sourceFile']['path']}` `{request['inputHash']}`\n"
        f"- UTC epoch: {model['scenario']['epochUtc']} (model leap-second assumption: {model['scenario']['leapSeconds']} s)\n"
        f"- Native samples: {metrics['samples']} over {metrics['stopSeconds']:g} s\n"
        '- Trajectory: `trajectory.csv` (42 Earth-centered N frame, SI units)\n'
        '- Raw: `time.42`, `PosN.42`, `VelN.42`, `PosW.42`; run log and modified 42 inputs retained.\n'
        '- Native `PosW.42` is 42 Earth rotating W frame, not a certified ITRF/EOP solution.\n\n'
        'This is a short reference-orbit study. It does not establish footprint, revisit, '
        'three-month operation, ground delivery, mission or hardware acceptance.\n'
    )
    (work / 'report.md').write_text(report)
    (work / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    wanted = [
        (work / 'trajectory.csv', 'trajectory.csv', 'text/csv'),
        (work / 'report.md', 'report.md', 'text/markdown'),
        (work / 'receipt.json', 'receipt.json', 'application/json'),
        (work / 'InOut/time.42', 'time.42', 'text/plain'),
        (work / 'InOut/PosN.42', 'PosN.42', 'text/plain'),
        (work / 'InOut/VelN.42', 'VelN.42', 'text/plain'),
        (work / 'InOut/PosW.42', 'PosW.42', 'text/plain'),
        (work / 'InOut/Inp_Sim.txt', 'Inp_Sim.txt', 'text/plain'),
        (work / 'InOut/Orb_LEO.txt', 'Orb_LEO.txt', 'text/plain'),
        (log, 'native-42.log', 'text/plain'),
    ]
    files = [exported(file, name, mime) for file, name, mime in wanted]
    return {'schema': 'manta-orbit42-native-response-v1', 'success': success, 'exitCode': code,
            'tool': receipt['tool'], 'receipt': receipt, 'metrics': metrics,
            'scope': scope, 'files': files,
            'diagnostics': 'Native 42 completed; bounded trajectory parsed' if success else 'Native 42 completed but sanity checks failed'}


def terminate(signum, frame):
    if ACTIVE:
        try:
            os.killpg(ACTIVE.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    raise RuntimeError('Orbit job cancelled')


signal.signal(signal.SIGTERM, terminate)
signal.signal(signal.SIGHUP, terminate)


def cancel(job_id):
    if not JOB_ID.fullmatch(job_id):
        raise ValueError('Invalid orbit job ID')
    file = JOBS / job_id / 'process.json'
    if file.is_file():
        info = json.loads(file.read_text())
        if info.get('jobId') == job_id and isinstance(info.get('pid'), int) and info['pid'] > 1:
            try:
                os.kill(info['pid'], signal.SIGTERM)
            except ProcessLookupError:
                pass
    return {'jobId': job_id, 'cancelRequested': True}


def main():
    try:
        if len(sys.argv) == 3 and sys.argv[1] == '--cancel':
            print(json.dumps(cancel(sys.argv[2])))
        elif len(sys.argv) == 1:
            request, model, epoch = read_request()
            print(json.dumps(run(request, model, epoch)))
        else:
            raise ValueError('Unsupported orbit adapter arguments')
    except Exception as error:
        print(json.dumps({'schema': 'manta-orbit42-native-response-v1', 'success': False,
                          'exitCode': 1, 'diagnostics': str(error), 'files': []}))


if __name__ == '__main__':
    main()
