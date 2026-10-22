#!/usr/bin/env python3
"""Generate a dependency-free, deterministic Xcode project. No signing secrets."""
from pathlib import Path
import hashlib
import re
root = Path(__file__).resolve().parents[1]
ios = root / 'ios'
objects = {}
def uid(key): return hashlib.sha256(key.encode()).hexdigest()[:24].upper()
def q(value): return '"' + str(value).replace('\\','\\\\').replace('"','\\"') + '"'
def qkey(value):
    """pbxproj keys are unquoted only when they are plain identifiers."""
    text = str(value)
    return text if re.fullmatch(r'[A-Za-z0-9_]+', text) else q(text)
def obj(key, kind, **values):
    ident = uid(key); objects[ident] = {'isa': kind, **values}; return ident
class Ref(str): pass
def ref(key): return Ref(uid(key))
def serialize(value):
    if isinstance(value, Ref): return str(value)
    if isinstance(value, dict): return '{ ' + ' '.join(f'{qkey(k)} = {serialize(v)};' for k,v in value.items()) + ' }'
    if isinstance(value, list): return '(' + ', '.join(serialize(x) for x in value) + ')'
    return q(value)
files=[]; builds=[]
for path in sorted((ios / 'PhotoSelector').glob('*.swift')):
    key = 'file:' + path.name
    obj(key, 'PBXFileReference', lastKnownFileType='sourcecode.swift', path='PhotoSelector/' + path.name, sourceTree='<group>')
    obj('build:' + path.name, 'PBXBuildFile', fileRef=ref(key))
    files.append(ref(key)); builds.append(ref('build:' + path.name))
obj('assets', 'PBXFileReference',lastKnownFileType='folder.assetcatalog',path='PhotoSelector/Assets.xcassets',sourceTree='<group>')
obj('assetsbuild', 'PBXBuildFile',fileRef=ref('assets')); files.append(ref('assets'))
obj('privacy', 'PBXFileReference', lastKnownFileType='text.xml', path='PhotoSelector/PrivacyInfo.xcprivacy', sourceTree='<group>')
obj('privacy-build', 'PBXBuildFile', fileRef=ref('privacy')); files.append(ref('privacy'))
obj('signing', 'PBXFileReference', lastKnownFileType='text.xcconfig', path='Signing.xcconfig', sourceTree='<group>'); files.append(ref('signing'))
obj('product', 'PBXFileReference', explicitFileType='wrapper.application', path='PhotoSelector.app', sourceTree='BUILT_PRODUCTS_DIR')
obj('products', 'PBXGroup', children=[ref('product')], name='Products', sourceTree='<group>')
obj('group', 'PBXGroup', children=files + [ref('products')], sourceTree='<group>')
obj('sources', 'PBXSourcesBuildPhase', buildActionMask='2147483647', files=builds, runOnlyForDeploymentPostprocessing='0')
obj('resources', 'PBXResourcesBuildPhase', buildActionMask='2147483647', files=[ref('privacy-build'),ref('assetsbuild')], runOnlyForDeploymentPostprocessing='0')
obj('package', 'XCLocalSwiftPackageReference', relativePath='..')
obj('core', 'XCSwiftPackageProductDependency', package=ref('package'), productName='PhotoCore')
obj('core-link', 'PBXBuildFile', productRef=ref('core'))
obj('frameworks', 'PBXFrameworksBuildPhase', buildActionMask='2147483647', files=[ref('core-link')], runOnlyForDeploymentPostprocessing='0')
base={'SWIFT_VERSION':'5.0','IPHONEOS_DEPLOYMENT_TARGET':'18.0','SDKROOT':'iphoneos','CLANG_ENABLE_MODULES':'YES','ONLY_ACTIVE_ARCH':'YES'}
appsettings={'ENABLE_DEBUG_DYLIB':'NO','ASSETCATALOG_COMPILER_APPICON_NAME':'AppIcon','PRODUCT_NAME':'PhotoSelector','PRODUCT_BUNDLE_IDENTIFIER':'com.wujean.photoselector','INFOPLIST_FILE':'PhotoSelector/Info.plist','TARGETED_DEVICE_FAMILY':'1','SUPPORTED_PLATFORMS':'iphoneos iphonesimulator','CODE_SIGN_STYLE':'Automatic','MARKETING_VERSION':'0.1.0','CURRENT_PROJECT_VERSION':'1','SWIFT_EMIT_LOC_STRINGS':'YES','LD_RUNPATH_SEARCH_PATHS':['$(inherited)','@executable_path/Frameworks']}
for label, settings in [('project', base),('app',appsettings)]:
    for mode in ['Debug','Release']:
        extra = {'SWIFT_OPTIMIZATION_LEVEL':'-Onone','DEBUG_INFORMATION_FORMAT':'dwarf','SWIFT_ACTIVE_COMPILATION_CONDITIONS':'DEBUG','ENABLE_TESTABILITY':'YES'} if mode=='Debug' else {'SWIFT_OPTIMIZATION_LEVEL':'-O','DEBUG_INFORMATION_FORMAT':'dwarf-with-dsym'}
        config = {'baseConfigurationReference': ref('signing')} if label == 'project' else {}
        obj(label+mode, 'XCBuildConfiguration', name=mode, buildSettings={**settings,**extra}, **config)
    obj(label+'config','XCConfigurationList',buildConfigurations=[ref(label+'Debug'),ref(label+'Release')],defaultConfigurationIsVisible='0',defaultConfigurationName='Release')
obj('target','PBXNativeTarget',name='PhotoSelectorIOS',productName='PhotoSelector',productReference=ref('product'),productType='com.apple.product-type.application',buildConfigurationList=ref('appconfig'),buildPhases=[ref('sources'),ref('frameworks'),ref('resources')],buildRules=[],dependencies=[],packageProductDependencies=[ref('core')])
testbuilds=[]
for path in sorted((ios/'PhotoSelectorTests').glob('*.swift')):
    key='testfile:'+path.name
    obj(key,'PBXFileReference',lastKnownFileType='sourcecode.swift',path='PhotoSelectorTests/'+path.name,sourceTree='<group>')
    obj('testbuild:'+path.name,'PBXBuildFile',fileRef=ref(key))
    objects[uid('group')]['children'].append(ref(key))
    testbuilds.append(ref('testbuild:'+path.name))
obj('testproduct','PBXFileReference',explicitFileType='wrapper.cfbundle',path='PhotoSelectorTests.xctest',sourceTree='BUILT_PRODUCTS_DIR')
objects[uid('products')]['children'].append(ref('testproduct'))
obj('testsources','PBXSourcesBuildPhase',buildActionMask='2147483647',files=testbuilds,runOnlyForDeploymentPostprocessing='0')
obj('testcore','XCSwiftPackageProductDependency',package=ref('package'),productName='PhotoCore')
obj('testcorelink','PBXBuildFile',productRef=ref('testcore'))
obj('testframeworks','PBXFrameworksBuildPhase',buildActionMask='2147483647',files=[],runOnlyForDeploymentPostprocessing='0')
obj('proxy','PBXContainerItemProxy',containerPortal=ref('project'),proxyType='1',remoteGlobalIDString=ref('target'),remoteInfo='PhotoSelector')
obj('testdependency','PBXTargetDependency',target=ref('target'),targetProxy=ref('proxy'))
for mode in ['Debug','Release']:
    obj('test'+mode,'XCBuildConfiguration',name=mode,buildSettings={**base,'PRODUCT_BUNDLE_IDENTIFIER':'com.wujean.photoselector.tests','PRODUCT_NAME':'$(TARGET_NAME)','GENERATE_INFOPLIST_FILE':'YES','TEST_HOST':'$(BUILT_PRODUCTS_DIR)/PhotoSelector.app/$(BUNDLE_EXECUTABLE_FOLDER_PATH)/PhotoSelector','BUNDLE_LOADER':'$(TEST_HOST)','CODE_SIGN_STYLE':'Automatic','SWIFT_OPTIMIZATION_LEVEL':'-Onone'})
obj('testconfig','XCConfigurationList',buildConfigurations=[ref('testDebug'),ref('testRelease')],defaultConfigurationIsVisible='0',defaultConfigurationName='Release')
obj('testtarget','PBXNativeTarget',name='PhotoSelectorTests',productName='PhotoSelectorTests',productReference=ref('testproduct'),productType='com.apple.product-type.bundle.unit-test',buildConfigurationList=ref('testconfig'),buildPhases=[ref('testsources'),ref('testframeworks')],buildRules=[],dependencies=[ref('testdependency')],packageProductDependencies=[])
obj('uifile','PBXFileReference',lastKnownFileType='sourcecode.swift',path='PhotoSelectorUITests/FlowTests.swift',sourceTree='<group>')
obj('uibuild','PBXBuildFile',fileRef=ref('uifile'))
obj('uiproduct','PBXFileReference',explicitFileType='wrapper.cfbundle',path='PhotoSelectorUITests.xctest',sourceTree='BUILT_PRODUCTS_DIR')
objects[uid('group')]['children'].append(ref('uifile')); objects[uid('products')]['children'].append(ref('uiproduct'))
obj('uisources','PBXSourcesBuildPhase',buildActionMask='2147483647',files=[ref('uibuild')],runOnlyForDeploymentPostprocessing='0')
for mode in ['Debug','Release']:
    obj('ui'+mode,'XCBuildConfiguration',name=mode,buildSettings={**base,'PRODUCT_BUNDLE_IDENTIFIER':'com.wujean.photoselector.uitests','PRODUCT_NAME':'$(TARGET_NAME)','GENERATE_INFOPLIST_FILE':'YES','TEST_TARGET_NAME':'PhotoSelectorIOS','CODE_SIGN_STYLE':'Automatic'})
obj('uiconfig','XCConfigurationList',buildConfigurations=[ref('uiDebug'),ref('uiRelease')],defaultConfigurationIsVisible='0',defaultConfigurationName='Release')
obj('uitarget','PBXNativeTarget',name='PhotoSelectorUITests',productName='PhotoSelectorUITests',productReference=ref('uiproduct'),productType='com.apple.product-type.bundle.ui-testing',buildConfigurationList=ref('uiconfig'),buildPhases=[ref('uisources')],buildRules=[],dependencies=[ref('testdependency')])
obj('project','PBXProject',attributes={'LastUpgradeCheck':'2710','TargetAttributes':{uid('uitarget'):{'TestTargetID':ref('target')},uid('testtarget'):{'TestTargetID':ref('target')}}},buildConfigurationList=ref('projectconfig'),compatibilityVersion='Xcode 14.0',developmentRegion='zh-Hans',knownRegions=['zh-Hans','en','Base'],mainGroup=ref('group'),productRefGroup=ref('products'),projectDirPath='',projectRoot='',targets=[ref('target'),ref('testtarget'),ref('uitarget')],packageReferences=[ref('package')])
project=ios/'PhotoSelector.xcodeproj'; project.mkdir(exist_ok=True)
(project/'project.pbxproj').write_text('// !$*UTF8*$!\n'+serialize({'archiveVersion':'1','classes':{},'objectVersion':'56','objects':{k:v for k,v in sorted(objects.items())},'rootObject':ref('project')})+'\n')
scheme=project/'xcshareddata'/'xcschemes'; scheme.mkdir(parents=True,exist_ok=True)
(scheme/'PhotoSelector.xcscheme').write_text(f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="2710" version="1.7">
<BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{uid('target')}" BuildableName="PhotoSelector.app" BlueprintName="PhotoSelectorIOS" ReferencedContainer="container:PhotoSelector.xcodeproj"/></BuildActionEntry></BuildActionEntries></BuildAction>
<TestAction buildConfiguration="Debug"><Testables><TestableReference skipped="NO"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{uid('testtarget')}" BuildableName="PhotoSelectorTests.xctest" BlueprintName="PhotoSelectorTests" ReferencedContainer="container:PhotoSelector.xcodeproj"/></TestableReference><TestableReference skipped="NO"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{uid('uitarget')}" BuildableName="PhotoSelectorUITests.xctest" BlueprintName="PhotoSelectorUITests" ReferencedContainer="container:PhotoSelector.xcodeproj"/></TestableReference></Testables></TestAction>
<LaunchAction buildConfiguration="Debug" useCustomWorkingDirectory="NO" debugServiceExtension="internal" launchStyle="0"><BuildableProductRunnable runnableDebuggingMode="0"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{uid('target')}" BuildableName="PhotoSelector.app" BlueprintName="PhotoSelectorIOS" ReferencedContainer="container:PhotoSelector.xcodeproj"/></BuildableProductRunnable></LaunchAction>
<ProfileAction buildConfiguration="Release"/>
<AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>''')
print(project)
