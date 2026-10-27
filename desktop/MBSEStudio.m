#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#include <signal.h>
#include <string.h>

static NSString *MantaResolveNode(void) {
    NSDictionary *environment=NSProcessInfo.processInfo.environment;
    NSString *configured=environment[@"MBSE_NODE"];
    NSArray *commands=configured.length?@[configured]:@[@"node"];
    for(NSString *command in commands){
        NSArray *candidates;
        if([command containsString:@"/"])candidates=@[command.isAbsolutePath?command:[NSFileManager.defaultManager.currentDirectoryPath stringByAppendingPathComponent:command]];
        else {
            NSMutableArray *onPath=[NSMutableArray new];
            for(NSString *directory in [environment[@"PATH"] componentsSeparatedByString:@":"])
                if(directory.length)[onPath addObject:[directory stringByAppendingPathComponent:command]];
            candidates=onPath;
        }
        for(NSString *candidate in candidates){
            BOOL directory=NO;
            if([NSFileManager.defaultManager fileExistsAtPath:candidate isDirectory:&directory]&&!directory&&[NSFileManager.defaultManager isExecutableFileAtPath:candidate])return candidate.stringByStandardizingPath;
        }
    }
    // An explicit override is authoritative; never hide a configuration error.
    if(configured.length)return nil;
    for(NSString *candidate in @[@"/opt/homebrew/bin/node",@"/usr/local/bin/node"])
        if([NSFileManager.defaultManager isExecutableFileAtPath:candidate])return candidate;
    return nil;
}

static BOOL MantaApplicationURL(NSURL *url, NSString *origin) {
    if(!url||!origin.length)return NO;
    NSURLComponents *value=[NSURLComponents componentsWithURL:url resolvingAgainstBaseURL:NO];
    NSURLComponents *expected=[NSURLComponents componentsWithString:origin];
    return [value.scheme isEqualToString:@"http"]&&[value.host isEqualToString:@"127.0.0.1"]&&
        [value.scheme isEqualToString:expected.scheme]&&[value.host isEqualToString:expected.host]&&
        value.port&&[value.port isEqual:expected.port]&&value.user==nil&&value.password==nil;
}
static BOOL MantaTrustedFrame(NSString *origin,NSURL *url,BOOL mainFrame,NSString *protocol,NSString *host,NSInteger port) {
    NSURLComponents *expected=[NSURLComponents componentsWithString:origin];
    return mainFrame&&MantaApplicationURL(url,origin)&&[protocol isEqualToString:expected.scheme]&&
        [host isEqualToString:expected.host]&&port==expected.port.integerValue;
}
static BOOL MantaValidRequestID(id value) {
    if(![value isKindOfClass:NSString.class]||![value length]||[value length]>128)return NO;
    return [value rangeOfString:@"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$" options:NSRegularExpressionSearch].location!=NSNotFound;
}
static int MantaVerifyBridgePolicy(void) {
    NSString *origin=@"http://127.0.0.1:4317";
    BOOL own=MantaTrustedFrame(origin,[NSURL URLWithString:@"http://127.0.0.1:4317/?project=p"],YES,@"http",@"127.0.0.1",4317);
    BOOL iframe=!MantaTrustedFrame(origin,[NSURL URLWithString:origin],NO,@"http",@"127.0.0.1",4317);
    BOOL foreign=YES;
    for(NSString *url in @[@"https://127.0.0.1:4317/",@"http://127.0.0.1:4318/",@"http://localhost:4317/",@"http://127.0.0.1.evil.example:4317/",@"http://user@127.0.0.1:4317/",@"file:///tmp/index.html",@"about:blank"])
        foreign=foreign&&!MantaApplicationURL([NSURL URLWithString:url],origin);
    BOOL spoofed=!MantaTrustedFrame(origin,[NSURL URLWithString:origin],YES,@"https",@"127.0.0.1",4317);
    BOOL ids=MantaValidRequestID(@"folder-123:abc")&&!MantaValidRequestID(@"")&&!MantaValidRequestID(@"bad');alert(1)//")&&!MantaValidRequestID(@123)&&!MantaValidRequestID([@"x" stringByPaddingToLength:129 withString:@"x" startingAtIndex:0]);
    BOOL passed=own&&iframe&&foreign&&spoofed&&ids;
    NSDictionary *result=@{@"application":@"Manta",@"bridge":@"syspilot",@"passed":@(passed),@"ownMainFrame":@(own),@"iframeRejected":@(iframe),@"foreignOriginsRejected":@(foreign),@"spoofedSecurityOriginRejected":@(spoofed),@"requestIDsValidated":@(ids),@"folderPanelOpened":@NO};
    NSData *json=[NSJSONSerialization dataWithJSONObject:result options:NSJSONWritingPrettyPrinted error:nil];
    fwrite(json.bytes,1,json.length,stdout);fputc('\n',stdout);return passed?0:1;
}

typedef NS_ENUM(NSInteger, MantaServiceWaitResult) {
    MantaServiceReady,
    MantaServiceExited,
    MantaServiceTimedOut
};
static MantaServiceWaitResult MantaWaitForService(NSTask *service, NSTimeInterval timeout, BOOL (^healthy)(void)) {
    NSTimeInterval deadline=NSProcessInfo.processInfo.systemUptime+timeout;
    while(NSProcessInfo.processInfo.systemUptime<deadline){
        if(!service.running)return MantaServiceExited;
        if(healthy())return MantaServiceReady;
        NSTimeInterval remaining=deadline-NSProcessInfo.processInfo.systemUptime;
        if(remaining>0)[NSThread sleepForTimeInterval:MIN(0.25,remaining)];
    }
    return service.running?MantaServiceTimedOut:MantaServiceExited;
}

@interface StudioDelegate : NSObject <NSApplicationDelegate,WKNavigationDelegate,WKUIDelegate,WKDownloadDelegate,WKScriptMessageHandler>
@property NSWindow *window;
@property WKWebView *web;
@property NSTask *service;
@property NSString *sourceRoot;
@property NSString *dataRoot;
@property NSString *origin;
@property NSString *initialPath;
@property NSMutableDictionary *status;
@property BOOL verifyAndExit;
@property NSOpenPanel *folderPanel;
@property NSString *folderRequestID;
@end
@implementation StudioDelegate
- (void)record:(NSDictionary *)fields {
    if(!self.status)self.status=[NSMutableDictionary new];
    [self.status addEntriesFromDictionary:fields];
    NSData *json=[NSJSONSerialization dataWithJSONObject:self.status options:NSJSONWritingPrettyPrinted error:nil];
    if(json&&self.dataRoot.length)[json writeToFile:[self.dataRoot stringByAppendingPathComponent:@"desktop-status.json"] options:NSDataWritingAtomic error:nil];
}
- (BOOL)healthy {
    NSMutableURLRequest *request=[NSMutableURLRequest requestWithURL:[NSURL URLWithString:[self.origin stringByAppendingString:@"/api/health"]] cachePolicy:NSURLRequestReloadIgnoringLocalCacheData timeoutInterval:1.0];
    dispatch_semaphore_t semaphore=dispatch_semaphore_create(0);__block BOOL ready=NO;
    NSURLSessionDataTask *task=[NSURLSession.sharedSession dataTaskWithRequest:request completionHandler:^(NSData *data,NSURLResponse *response,NSError *error){if(data){NSDictionary *value=[NSJSONSerialization JSONObjectWithData:data options:0 error:nil];ready=[value[@"app"] isEqual:@"mbse-studio"]&&[value[@"ok"] boolValue];}dispatch_semaphore_signal(semaphore);}];
    [task resume];dispatch_semaphore_wait(semaphore,dispatch_time(DISPATCH_TIME_NOW,1500*NSEC_PER_MSEC));return ready;
}
- (void)fail:(NSString *)message {
    dispatch_async(dispatch_get_main_queue(), ^{[self record:@{@"error":message,@"ready":@NO}];if(self.verifyAndExit){fprintf(stderr,"Manta: %s\n",message.UTF8String);[NSApp terminate:nil];return;}NSAlert *alert=[NSAlert new];alert.messageText=@"Manta 启动未完成";alert.informativeText=message;[alert runModal];[NSApp terminate:nil];});
}
- (BOOL)trustedMainFrame:(WKFrameInfo *)frame {
    return MantaTrustedFrame(self.origin,frame.request.URL,frame.mainFrame,frame.securityOrigin.protocol,frame.securityOrigin.host,frame.securityOrigin.port);
}
- (void)folderReply:(NSString *)requestID path:(NSString *)path cancelled:(BOOL)cancelled error:(NSString *)error {
    if(!MantaApplicationURL(self.web.URL,self.origin)||!MantaValidRequestID(requestID))return;
    NSDictionary *result=@{@"requestId":requestID,@"path":path?:NSNull.null,@"cancelled":@(cancelled),@"error":error?:NSNull.null};
    // Arguments cross the WebKit value bridge; no path or request ID becomes executable JavaScript.
    [self.web callAsyncJavaScript:@"if(typeof window.syspilotFolderSelected==='function'){window.syspilotFolderSelected(result);}"
        arguments:@{@"result":result} inFrame:nil inContentWorld:WKContentWorld.pageWorld completionHandler:nil];
}
- (void)userContentController:(WKUserContentController *)controller didReceiveScriptMessage:(WKScriptMessage *)message {
    if(![message.name isEqualToString:@"syspilot"]||message.webView!=self.web||![self trustedMainFrame:message.frameInfo]||!MantaApplicationURL(self.web.URL,self.origin))return;
    if(![message.body isKindOfClass:NSDictionary.class])return;
    NSDictionary *body=message.body;NSString *requestID=body[@"requestId"];
    if(!MantaValidRequestID(requestID))return;
    if(![body[@"type"] isKindOfClass:NSString.class]||![body[@"type"] isEqualToString:@"choose-project-folder"]){[self folderReply:requestID path:nil cancelled:NO error:@"不支持的原生请求类型。"];return;}
    if(self.verifyAndExit){[self folderReply:requestID path:nil cancelled:NO error:@"启动验证模式不打开文件夹选择窗口。"];return;}
    if(self.folderPanel){if(![self.folderRequestID isEqualToString:requestID])[self folderReply:requestID path:nil cancelled:NO error:@"已有文件夹选择窗口，请完成或取消后重试。"];return;}
    NSOpenPanel *panel=[NSOpenPanel openPanel];panel.title=@"为 Manta 选择项目文件夹";panel.prompt=@"选择文件夹";
    panel.canChooseDirectories=YES;panel.canChooseFiles=NO;panel.allowsMultipleSelection=NO;panel.canCreateDirectories=NO;panel.resolvesAliases=YES;panel.treatsFilePackagesAsDirectories=NO;
    self.folderPanel=panel;self.folderRequestID=requestID;
    [panel beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse response){
        NSString *selected=nil,*error=nil;BOOL cancelled=response!=NSModalResponseOK;
        if(!cancelled){NSURL *url=panel.URL.URLByResolvingSymlinksInPath;BOOL directory=NO;NSString *candidate=url.path.stringByStandardizingPath;
            if(!url.isFileURL||!candidate.isAbsolutePath||![NSFileManager.defaultManager fileExistsAtPath:candidate isDirectory:&directory]||!directory)error=@"请选择一个现有文件夹。";else selected=candidate;}
        self.folderPanel=nil;self.folderRequestID=nil;
        [self folderReply:requestID path:selected cancelled:cancelled error:error];
    }];
}
- (void)reload:(id)sender {[self.web reloadFromOrigin];}
- (void)openSettings:(id)sender {
    if(!MantaApplicationURL(self.web.URL,self.origin))return;
    [self.web evaluateJavaScript:@"window.dispatchEvent(new CustomEvent('syspilot:open-settings'))" completionHandler:nil];
}
- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    NSString *port=@"4317";
    self.sourceRoot=NSProcessInfo.processInfo.environment[@"MBSE_SOURCE_ROOT"];
    self.dataRoot=NSProcessInfo.processInfo.environment[@"MBSE_DATA_DIR"];
    self.initialPath=@"/";
    for(NSString *arg in NSProcessInfo.processInfo.arguments){
        if([arg isEqual:@"--verify-and-exit"])self.verifyAndExit=YES;
        if([arg hasPrefix:@"--source-root="])self.sourceRoot=[arg substringFromIndex:14];
        if([arg hasPrefix:@"--data-root="])self.dataRoot=[arg substringFromIndex:12];
        if([arg hasPrefix:@"--port="])port=[arg substringFromIndex:7];
        if([arg hasPrefix:@"--initial-path="])self.initialPath=[arg substringFromIndex:15];
    }
    if(!self.sourceRoot.length)self.sourceRoot=[NSProcessInfo.processInfo.arguments.firstObject.stringByDeletingLastPathComponent stringByDeletingLastPathComponent];
    self.sourceRoot=self.sourceRoot.stringByStandardizingPath.stringByResolvingSymlinksInPath;
    if(!self.dataRoot.length)self.dataRoot=[self.sourceRoot stringByAppendingPathComponent:@"data"];
    self.dataRoot=self.dataRoot.stringByStandardizingPath.stringByResolvingSymlinksInPath;
    self.origin=[@"http://127.0.0.1:" stringByAppendingString:port];
    if([port rangeOfString:@"^[0-9]{1,5}$" options:NSRegularExpressionSearch].location==NSNotFound||port.intValue<1||port.intValue>65535||![self.initialPath hasPrefix:@"/"]||[self.initialPath hasPrefix:@"//"]||!MantaApplicationURL([NSURL URLWithString:[self.origin stringByAppendingString:self.initialPath]],self.origin)){[self fail:@"本地端口或页面路径无效。"];return;}
    [NSFileManager.defaultManager createDirectoryAtPath:self.dataRoot withIntermediateDirectories:YES attributes:nil error:nil];
    self.status=[@{@"application":@"Manta",@"nativeBridge":@"syspilot",@"pid":@(NSProcessInfo.processInfo.processIdentifier),@"sourceRoot":self.sourceRoot,@"dataRoot":self.dataRoot,@"origin":self.origin,@"applicationBundle":@NO,@"ready":@NO}mutableCopy];
    [self record:@{}];
    NSMenu *menu=[NSMenu new];NSMenuItem *appItem=[NSMenuItem new];[menu addItem:appItem];NSMenu *app=[NSMenu new];app.title=@"Manta";appItem.title=@"Manta";NSMenuItem *settingsItem=[app addItemWithTitle:@"设置…" action:@selector(openSettings:) keyEquivalent:@","];settingsItem.target=self;[app addItem:NSMenuItem.separatorItem];[app addItemWithTitle:@"退出 Manta" action:@selector(terminate:) keyEquivalent:@"q"];appItem.submenu=app;
    NSMenuItem *editItem=[NSMenuItem new];[menu addItem:editItem];NSMenu *edit=[NSMenu new];edit.title=@"编辑";editItem.submenu=edit;
    [edit addItemWithTitle:@"撤销" action:@selector(undo:) keyEquivalent:@"z"];NSMenuItem *redo=[edit addItemWithTitle:@"重做" action:@selector(redo:) keyEquivalent:@"Z"];redo.keyEquivalentModifierMask=NSEventModifierFlagCommand|NSEventModifierFlagShift;
    [edit addItem:NSMenuItem.separatorItem];[edit addItemWithTitle:@"剪切" action:@selector(cut:) keyEquivalent:@"x"];[edit addItemWithTitle:@"复制" action:@selector(copy:) keyEquivalent:@"c"];[edit addItemWithTitle:@"粘贴" action:@selector(paste:) keyEquivalent:@"v"];[edit addItemWithTitle:@"全选" action:@selector(selectAll:) keyEquivalent:@"a"];
    NSMenuItem *windowItem=[NSMenuItem new];[menu addItem:windowItem];NSMenu *window=[NSMenu new];window.title=@"窗口";windowItem.submenu=window;[window addItemWithTitle:@"刷新工作台" action:@selector(reload:) keyEquivalent:@"r"];[window addItemWithTitle:@"最小化" action:@selector(performMiniaturize:) keyEquivalent:@"m"];[window addItemWithTitle:@"关闭窗口" action:@selector(performClose:) keyEquivalent:@"w"];
    NSApp.mainMenu=menu;
    NSImage *image=[[NSImage alloc]initWithContentsOfFile:[self.sourceRoot stringByAppendingPathComponent:@"desktop/AppIcon.icns"]];if(image)NSApp.applicationIconImage=image;
    self.window=[[NSWindow alloc]initWithContentRect:NSMakeRect(0,0,1400,900) styleMask:NSWindowStyleMaskTitled|NSWindowStyleMaskClosable|NSWindowStyleMaskMiniaturizable|NSWindowStyleMaskResizable backing:NSBackingStoreBuffered defer:NO];
    self.window.title=@"Manta";self.window.releasedWhenClosed=NO;self.window.minSize=NSMakeSize(900,620);[self.window center];
    WKWebViewConfiguration *configuration=[WKWebViewConfiguration new];[configuration.userContentController addScriptMessageHandler:self name:@"syspilot"];self.web=[[WKWebView alloc]initWithFrame:self.window.contentView.bounds configuration:configuration];self.web.autoresizingMask=NSViewWidthSizable|NSViewHeightSizable;self.web.navigationDelegate=self;self.web.UIDelegate=self;[self.window.contentView addSubview:self.web];[self.window makeKeyAndOrderFront:nil];[NSApp activateIgnoringOtherApps:YES];
    [self.web loadHTMLString:@"<body style='background:#f7f6f2;color:#445d49;font:18px -apple-system;padding:80px'><h1 style='font:40px Georgia'>Manta</h1><p>正在启动 Manta…</p>" baseURL:nil];
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED,0), ^{
        if(![self healthy]){
            NSString *entry=[self.sourceRoot stringByAppendingPathComponent:@"server/index.mjs"];
            if(![NSFileManager.defaultManager fileExistsAtPath:entry]){[self fail:@"找不到外部服务源码。请通过 scripts/desktop.sh 从项目目录启动。"];return;}
            NSString *node=MantaResolveNode();
            if(!node){[self fail:@"找不到 Node.js。请将 Node.js 放在 PATH 中，或用 MBSE_NODE 指定有效的可执行文件。"];return;}
            NSString *log=[self.dataRoot stringByAppendingPathComponent:@"server.log"];if(![NSFileManager.defaultManager fileExistsAtPath:log])[NSFileManager.defaultManager createFileAtPath:log contents:nil attributes:nil];NSFileHandle *handle=[NSFileHandle fileHandleForWritingAtPath:log];[handle seekToEndOfFile];
            self.service=[NSTask new];self.service.executableURL=[NSURL fileURLWithPath:node];self.service.arguments=@[entry];self.service.currentDirectoryURL=[NSURL fileURLWithPath:self.sourceRoot];self.service.standardOutput=handle;self.service.standardError=handle;
            NSMutableDictionary *environment=[NSProcessInfo.processInfo.environment mutableCopy];environment[@"PORT"]=port;environment[@"MBSE_DATA_DIR"]=self.dataRoot;self.service.environment=environment;
            NSError *error=nil;if(![self.service launchAndReturnError:&error]){[self fail:error.localizedDescription];return;}
            MantaServiceWaitResult started=MantaWaitForService(self.service,90.0,^{return [self healthy];});
            if(started==MantaServiceExited){[self fail:[NSString stringWithFormat:@"Manta 服务启动时退出（退出码 %d）。详细记录：%@",self.service.terminationStatus,log]];return;}
            if(started==MantaServiceTimedOut){[self fail:[NSString stringWithFormat:@"Manta 启动超过 90 秒。请确认项目所在磁盘已连接，然后重试。详细记录：%@",log]];return;}
        }
        dispatch_async(dispatch_get_main_queue(), ^{[self record:@{@"serviceStartedByWindow":@(self.service.running)}];[self.web loadRequest:[NSURLRequest requestWithURL:[NSURL URLWithString:[self.origin stringByAppendingString:self.initialPath]]]];});
    });
}
- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender{return YES;}
- (void)applicationWillTerminate:(NSNotification *)notification {[self.web.configuration.userContentController removeScriptMessageHandlerForName:@"syspilot"];[self record:@{@"terminationRequested":@YES}];if(self.service.running)[self.service terminate];}
- (void)webView:(WKWebView *)web didFinishNavigation:(WKNavigation *)navigation {
    if(!MantaApplicationURL(web.URL,self.origin))return;
    NSString *probe=@"for(let i=0;i<60;i++){if(document.querySelector('.app-shell'))return {hasAppShell:true,title:document.title,url:location.href};await new Promise(r=>setTimeout(r,100));}return {hasAppShell:false,title:document.title,url:location.href};";
    [web callAsyncJavaScript:probe arguments:@{} inFrame:nil inContentWorld:WKContentWorld.pageWorld completionHandler:^(id value,NSError *error){NSMutableDictionary *fields=[@{@"windowVisible":@(self.window.visible),@"ready":@(!error&&[value[@"hasAppShell"]boolValue])}mutableCopy];if(value)fields[@"page"]=value;if(error)fields[@"error"]=error.localizedDescription;[self record:fields];if(self.verifyAndExit&&[fields[@"ready"]boolValue])dispatch_async(dispatch_get_main_queue(), ^{[self.window performClose:nil];});}];
}
- (void)webView:(WKWebView *)web didFailProvisionalNavigation:(WKNavigation *)navigation withError:(NSError *)error {if(error.code==NSURLErrorCancelled)return;[self record:@{@"ready":@NO,@"navigationError":error.localizedDescription}];}
- (void)webView:(WKWebView *)web decidePolicyForNavigationAction:(WKNavigationAction *)action decisionHandler:(void (^)(WKNavigationActionPolicy))handler {
    NSURL *url=action.request.URL;
    if(action.shouldPerformDownload&&(MantaApplicationURL(url,self.origin)||[url.scheme isEqual:@"blob"])){handler(WKNavigationActionPolicyDownload);return;}
    if([url.scheme isEqual:@"blob"]||[url.absoluteString isEqual:@"about:blank"]||MantaApplicationURL(url,self.origin)){handler(WKNavigationActionPolicyAllow);return;}
    if([@[@"http",@"https"]containsObject:url.scheme])[NSWorkspace.sharedWorkspace openURL:url];handler(WKNavigationActionPolicyCancel);
}
- (WKWebView *)webView:(WKWebView *)web createWebViewWithConfiguration:(WKWebViewConfiguration *)configuration forNavigationAction:(WKNavigationAction *)action windowFeatures:(WKWindowFeatures *)features {if([@[@"http",@"https"]containsObject:action.request.URL.scheme])[NSWorkspace.sharedWorkspace openURL:action.request.URL];return nil;}
- (void)webView:(WKWebView *)web runOpenPanelWithParameters:(WKOpenPanelParameters *)parameters initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(NSArray<NSURL *> *))handler {if(![self trustedMainFrame:frame]){handler(nil);return;}NSOpenPanel *panel=[NSOpenPanel openPanel];panel.canChooseDirectories=parameters.allowsDirectories;panel.allowsMultipleSelection=parameters.allowsMultipleSelection;[panel beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse result){handler(result==NSModalResponseOK?panel.URLs:nil);}];}
- (void)webView:(WKWebView *)web navigationAction:(WKNavigationAction *)action didBecomeDownload:(WKDownload *)download {download.delegate=self;}
- (void)webView:(WKWebView *)web navigationResponse:(WKNavigationResponse *)response didBecomeDownload:(WKDownload *)download {download.delegate=self;}
- (void)download:(WKDownload *)download decideDestinationUsingResponse:(NSURLResponse *)response suggestedFilename:(NSString *)filename completionHandler:(void (^)(NSURL *))handler {NSSavePanel *panel=[NSSavePanel savePanel];panel.nameFieldStringValue=filename;[panel beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse result){handler(result==NSModalResponseOK?panel.URL:nil);}];}
@end
int main(int argc,const char *argv[]){@autoreleasepool{for(int i=1;i<argc;i++)if(strcmp(argv[i],"--verify-bridge-policy")==0)return MantaVerifyBridgePolicy();[NSProcessInfo.processInfo setProcessName:@"Manta"];NSApplication *app=NSApplication.sharedApplication;[app setActivationPolicy:NSApplicationActivationPolicyRegular];__attribute__((objc_precise_lifetime)) StudioDelegate *delegate=[StudioDelegate new];app.delegate=delegate;signal(SIGINT,SIG_IGN);signal(SIGTERM,SIG_IGN);signal(SIGHUP,SIG_IGN);static dispatch_source_t interruptSource,terminateSource,reloadSource;interruptSource=dispatch_source_create(DISPATCH_SOURCE_TYPE_SIGNAL,SIGINT,0,dispatch_get_main_queue());terminateSource=dispatch_source_create(DISPATCH_SOURCE_TYPE_SIGNAL,SIGTERM,0,dispatch_get_main_queue());dispatch_source_set_event_handler(interruptSource,^{[app terminate:nil];});dispatch_source_set_event_handler(terminateSource,^{[app terminate:nil];});reloadSource=dispatch_source_create(DISPATCH_SOURCE_TYPE_SIGNAL,SIGHUP,0,dispatch_get_main_queue());dispatch_source_set_event_handler(reloadSource,^{[delegate reload:nil];});dispatch_resume(interruptSource);dispatch_resume(terminateSource);dispatch_resume(reloadSource);[app run];}return 0;}
