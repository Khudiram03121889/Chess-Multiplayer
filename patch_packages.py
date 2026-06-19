import os
import re

print("Scanning node_modules for Package.swift files...")
patched_count = 0

for root, dirs, files in os.walk("node_modules"):
    for file in files:
        if file == "Package.swift":
            path = os.path.join(root, file)
            try:
                with open(path, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read()
                
                modified = False
                
                # 1. Allow swift-tools-version up to 6.1; only downgrade if > 6.1 (e.g. 6.2+)
                # Xcode 16.4 ships Swift 6.1 so tools-version: 6.1 is fully supported.
                match = re.match(r"^//\s*swift-tools-version:\s*([\d\.]+)", content)
                if match:
                    version = match.group(1)
                    parts = version.split('.')
                    if len(parts) >= 2:
                        try:
                            major, minor = int(parts[0]), int(parts[1])
                            if major > 6 or (major == 6 and minor > 1):
                                print(f"Downgrading tools-version in {path} from {version} to 6.1")
                                content = re.sub(
                                    r"^//\s*swift-tools-version:\s*[\d\.]+",
                                    "// swift-tools-version: 6.1",
                                    content
                                )
                                modified = True
                        except ValueError:
                            pass

                # 2. Pin apple/swift-collections to 1.1.4 (compatible with Swift 6.1)
                if "swift-collections" in content and "1.1.4" not in content:
                    print(f"Pinning swift-collections in {path}")
                    content = re.sub(
                        r'\.package\(url:\s*["\']https://github.com/apple/swift-collections(?:\.git)?["\']\s*,\s*[^)]+\)',
                        '.package(url: "https://github.com/apple/swift-collections.git", exact: "1.1.4")',
                        content
                    )
                    modified = True

                # 3. Pin apple/swift-syntax to 601.0.1 (ships with Swift 6.1 / Xcode 16.4)
                if "swift-syntax" in content and "601.0.1" not in content:
                    print(f"Pinning swift-syntax in {path}")
                    content = re.sub(
                        r'\.package\(url:\s*["\']https://github.com/apple/swift-syntax(?:\.git)?["\']\s*,\s*[^)]+\)',
                        '.package(url: "https://github.com/apple/swift-syntax.git", exact: "601.0.1")',
                        content
                    )
                    modified = True

                if modified:
                    with open(path, "w", encoding="utf-8") as f:
                        f.write(content)
                    print(f"Successfully patched {path}")
                    patched_count += 1
            except Exception as e:
                print(f"Error processing {path}: {e}")

print(f"Scan complete. Patched {patched_count} Package.swift file(s).")

# 4. Scan all Swift files in node_modules and replace "weak let" with "weak var" to fix Swift 6 compiler error
print("Scanning node_modules for Swift files to fix 'weak let'...")
swift_patched = 0
for root, dirs, files in os.walk("node_modules"):
    for file in files:
        if file.endswith(".swift"):
            path = os.path.join(root, file)
            try:
                with open(path, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read()
                
                content_modified = False
                if "weak let" in content:
                    print(f"Fixing 'weak let' -> 'weak var' in {path}")
                    content = content.replace("weak let", "weak var")
                    content_modified = True

                # Manually patch the Sendable protocols for the files failing strict concurrency in Xcode 16.4
                if "JavaScriptPropNameID.swift" in path and "class JavaScriptPropNameID: JavaScriptType {" in content:
                    print(f"Adding @unchecked Sendable to JavaScriptPropNameID in {path}")
                    content = content.replace(
                        "class JavaScriptPropNameID: JavaScriptType {",
                        "class JavaScriptPropNameID: JavaScriptType, @unchecked Sendable {"
                    )
                    content_modified = True
                    
                if "JavaScriptValue.swift" in path and "class JavaScriptValue: JavaScriptType, Equatable, Escapable, Error {" in content:
                    print(f"Adding @unchecked Sendable to JavaScriptValue in {path}")
                    content = content.replace(
                        "class JavaScriptValue: JavaScriptType, Equatable, Escapable, Error {",
                        "class JavaScriptValue: JavaScriptType, Equatable, Escapable, Error, @unchecked Sendable {"
                    )
                    content_modified = True
                    
                if "HostFunctionContext.swift" in path and "class HostFunctionContext: Sendable {" in content:
                    print(f"Fixing Sendable for HostFunctionContext in {path}")
                    content = content.replace(
                        "class HostFunctionContext: Sendable {",
                        "class HostFunctionContext: @unchecked Sendable {"
                    )
                    content_modified = True
                    
                if "HostObjectContext.swift" in path and "class HostObjectContext: Sendable {" in content:
                    print(f"Fixing Sendable for HostObjectContext in {path}")
                    content = content.replace(
                        "class HostObjectContext: Sendable {",
                        "class HostObjectContext: @unchecked Sendable {"
                    )
                    content_modified = True

                if "Task+immediate.swift" in path:
                    content = content.replace("return Task.immediate(name: name, priority: priority, operation: operation)", "return Task(priority: priority, operation: operation)")
                    content = content.replace("return Task(name: name, priority: .high, operation: operation)", "return Task(priority: .high, operation: operation)")
                    content_modified = True
                
                # Fix consuming keyword in push_back
                if "JavaScriptRuntime.swift" in path:
                    if "vector.push_back(consuming: propNameId)" in content:
                        content = content.replace("vector.push_back(consuming: propNameId)", "vector.push_back(consume propNameId)")
                        content_modified = True
                    if "vector.push_back(propNameId)" in content:
                        content = content.replace("vector.push_back(propNameId)", "vector.push_back(consume propNameId)")
                        content_modified = True

                # Replace constructor calls with factory method calls in Swift
                if "JavaScriptRuntime.swift" in path:
                    if "expo.RuntimeScheduler()" in content:
                        content = content.replace("expo.RuntimeScheduler()", "expo.RuntimeScheduler.create()")
                        content_modified = True
                    if "expo.RuntimeScheduler(scheduler, fn)" in content:
                        content = content.replace("expo.RuntimeScheduler(scheduler, fn)", "expo.RuntimeScheduler.create(scheduler, fn)")
                        content_modified = True
                    if "expo.HostFunctionClosure(context, call, deallocate)" in content:
                        content = content.replace("expo.HostFunctionClosure(context, call, deallocate)", "expo.HostFunctionClosure.create(context, call, deallocate)")
                        content_modified = True
                        
                if "JavaScriptNativeState.swift" in path and "expo.NativeState(ptr, deallocate)" in content:
                    content = content.replace("expo.NativeState(ptr, deallocate)", "expo.NativeState.create(ptr, deallocate)")
                    content_modified = True

                if "JavaScriptRuntime.swift" in path and "_ arguments: consuming JavaScriptValuesBuffer," in content:
                    print(f"Fixing trailing comma in {path}")
                    content = content.replace("_ arguments: consuming JavaScriptValuesBuffer,", "_ arguments: consuming JavaScriptValuesBuffer")
                    content_modified = True

                if content_modified:
                    with open(path, "w", encoding="utf-8") as f:
                        f.write(content)
                    swift_patched += 1
            except Exception as e:
                print(f"Error patching Swift file {path}: {e}")
print(f"Fixed {swift_patched} Swift file(s).")

# 5. Patch C++ headers in expo-modules-jsi to add static factory methods for Swift 6 C++ interop
print("Scanning node_modules for C++ header files to fix initializers...")
cpp_patched = 0
for root, dirs, files in os.walk("node_modules"):
    for file in files:
        if file.endswith(".h"):
            path = os.path.join(root, file)
            try:
                with open(path, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read()
                
                content_modified = False
                
                if file == "RuntimeScheduler.h" and "RuntimeScheduler() {}" in content and "static RuntimeScheduler* create" not in content:
                    content = content.replace(
                        "RuntimeScheduler() {}",
                        "RuntimeScheduler() {}\n  static RuntimeScheduler* create() { return new RuntimeScheduler(); }\n  static RuntimeScheduler* create(void *scheduler, ScheduleFn fn) { return new RuntimeScheduler(scheduler, fn); }"
                    )
                    content_modified = True
                
                if file == "NativeState.h" and "explicit NativeState(Context context, Deallocator deallocator)" in content and "static NativeState* create" not in content:
                    content = content.replace(
                        "explicit NativeState(Context context, Deallocator deallocator) : RetainedSwiftPointer(context, deallocator) {}",
                        "explicit NativeState(Context context, Deallocator deallocator) : RetainedSwiftPointer(context, deallocator) {}\n  static NativeState* create(Context context, Deallocator deallocator) { return new NativeState(context, deallocator); }"
                    )
                    content_modified = True
                    
                if file == "HostFunctionClosure.h" and "explicit HostFunctionClosure(Context context, Closure closure, Deallocator deallocator)" in content and "static HostFunctionClosure" not in content:
                    # Clean up any trailing semi-colons and add the factory method
                    content = re.sub(
                        r"explicit HostFunctionClosure\(Context context, Closure closure, Deallocator deallocator\) : RetainedSwiftPointer\(context, deallocator\), _closure\(closure\) \{\};?",
                        "explicit HostFunctionClosure(Context context, Closure closure, Deallocator deallocator) : RetainedSwiftPointer(context, deallocator), _closure(closure) {}\\n  static HostFunctionClosure *_Nonnull create(Context context, Closure closure, Deallocator deallocator) { return new HostFunctionClosure(context, closure, deallocator); }",
                        content
                    )
                    content_modified = True

                if content_modified:
                    with open(path, "w", encoding="utf-8") as f:
                        f.write(content)
                    print(f"Patched C++ header {path}")
                    cpp_patched += 1
            except Exception as e:
                pass
print(f"Fixed {cpp_patched} C++ header file(s).")

# 6. Patch build-xcframework.sh in expo-modules-jsi to include OTHER_CPLUSPLUSFLAGS, disable code signing, and remove -quiet
print("Patching build-xcframework.sh in expo-modules-jsi...")
build_script_path = os.path.join("node_modules", "expo-modules-jsi", "apple", "scripts", "build-xcframework.sh")
if os.path.exists(build_script_path):
    try:
        with open(build_script_path, "r", encoding="utf-8") as f:
            content = f.read()
        
        # Remove -quiet flag
        if "-quiet \\" in content:
            content = content.replace("-quiet \\", "")
            print(f"Removed -quiet from {build_script_path}")

        target_str = "SWIFT_COMPILATION_MODE=wholemodule \\"
        replacement_str = "SWIFT_COMPILATION_MODE=wholemodule \\\n    CODE_SIGNING_ALLOWED=NO \\\n    CODE_SIGNING_REQUIRED=NO \\\n    CODE_SIGN_IDENTITY=\"\" \\\n    OTHER_CPLUSPLUSFLAGS='$(inherited) -D_LIBCPP_ENABLE_HARDENED_MODE=0 -D_LIBCPP_ENABLE_CXX17_REMOVED_UNARY_BINARY_FUNCTION -std=c++20' \\"
        
        if target_str in content and "CODE_SIGNING_ALLOWED=NO" not in content:
            # First remove any previous patch of OTHER_CPLUSPLUSFLAGS to ensure clean replacement
            old_patch = "SWIFT_COMPILATION_MODE=wholemodule \\\n    OTHER_CPLUSPLUSFLAGS='$(inherited) -D_LIBCPP_ENABLE_HARDENED_MODE=0 -D_LIBCPP_ENABLE_CXX17_REMOVED_UNARY_BINARY_FUNCTION -std=c++20' \\"
            content = content.replace(old_patch, target_str)
            
            content = content.replace(target_str, replacement_str)
            with open(build_script_path, "w", encoding="utf-8") as f:
                f.write(content)
            print(f"Patched {build_script_path}")
    except Exception as e:
        print(f"Error patching {build_script_path}: {e}")

# 7. Add dummy copy constructor to PropNameID in jsi.h to satisfy Xcode 16.4 Swift C++ Interop
print("Patching all jsi.h files for PropNameID dummy copy constructor...")
for root, dirs, files in os.walk("node_modules"):
    for file in files:
        if file == "jsi.h":
            jsi_path = os.path.join(root, file)
            try:
                with open(jsi_path, "r", encoding="utf-8") as f:
                    content = f.read()
                
                target_str = "PropNameID(PropNameID&& other) = default;"
                replacement_str = "PropNameID(PropNameID&& other) = default;\n  PropNameID(const PropNameID& other) : Pointer(other.ptr_) {}"
                
                if target_str in content and "PropNameID(const PropNameID& other)" not in content:
                    content = content.replace(target_str, replacement_str)
                    with open(jsi_path, "w", encoding="utf-8") as f:
                        f.write(content)
                    print(f"Patched {jsi_path}")
            except Exception as e:
                print(f"Error patching {jsi_path}: {e}")

# 8. Fix Swift 5.10 incompatible syntax: @MainActor on protocol conformance
print("Patching @MainActor on protocol conformances for Swift 5 mode...")
expo_modules_core_ios = os.path.join("node_modules", "expo-modules-core", "ios")
if os.path.exists(expo_modules_core_ios):
    for root, dirs, files in os.walk(expo_modules_core_ios):
        for file in files:
            if file.endswith(".swift"):
                path = os.path.join(root, file)
                try:
                    with open(path, "r", encoding="utf-8") as f:
                        content = f.read()
                    
                    original_content = content
                    
                    replacements = {
                        "extension UIView: @MainActor AnyArgument {":
                        "@MainActor\nextension UIView: AnyArgument {",
                        
                        "public final class HostingView<Props: ViewProps, ContentView: View<Props>>: ExpoView, @MainActor AnyExpoSwiftUIHostingView {":
                        "@MainActor\npublic final class HostingView<Props: ViewProps, ContentView: View<Props>>: ExpoView, AnyExpoSwiftUIHostingView {",
                        
                        "final class SwiftUIVirtualView<Props: ViewProps, ContentView: View<Props>>: SwiftUIVirtualViewObjC, @MainActor ExpoSwiftUIView {":
                        "@MainActor\nfinal class SwiftUIVirtualView<Props: ViewProps, ContentView: View<Props>>: SwiftUIVirtualViewObjC, ExpoSwiftUIView {",
                        
                        "extension ExpoSwiftUI.SwiftUIVirtualView: @MainActor ExpoSwiftUI.ViewWrapper {":
                        "@MainActor\nextension ExpoSwiftUI.SwiftUIVirtualView: ExpoSwiftUI.ViewWrapper {",
                        
                        "final class SwiftUIVirtualViewDev<Props: ViewProps, ContentView: View<Props>>: SwiftUIVirtualViewObjCDev, @MainActor ExpoSwiftUIView {":
                        "@MainActor\nfinal class SwiftUIVirtualViewDev<Props: ViewProps, ContentView: View<Props>>: SwiftUIVirtualViewObjCDev, ExpoSwiftUIView {",
                        
                        "extension ExpoSwiftUI.SwiftUIVirtualViewDev: @MainActor ExpoSwiftUI.ViewWrapper {":
                        "@MainActor\nextension ExpoSwiftUI.SwiftUIVirtualViewDev: ExpoSwiftUI.ViewWrapper {"
                    }
                    
                    for old_str, new_str in replacements.items():
                        if old_str in content:
                            content = content.replace(old_str, new_str)
                            print(f"Applied exact string replacement for @MainActor in {path}")
                    
                    # Fallback regex if we missed something exactly but can still find it safely
                    if ": @MainActor AnyArgument" in content:
                        content = content.replace(": @MainActor AnyArgument", ": AnyArgument")
                        print(f"Applied fallback replacement for @MainActor AnyArgument in {path}")
                    if ", @MainActor AnyExpoSwiftUIHostingView" in content:
                        content = content.replace(", @MainActor AnyExpoSwiftUIHostingView", ", AnyExpoSwiftUIHostingView")
                        print(f"Applied fallback replacement for @MainActor AnyExpoSwiftUIHostingView in {path}")
                    if ", @MainActor ExpoSwiftUIView" in content:
                        content = content.replace(", @MainActor ExpoSwiftUIView", ", ExpoSwiftUIView")
                        print(f"Applied fallback replacement for @MainActor ExpoSwiftUIView in {path}")
                    if ": @MainActor ExpoSwiftUI.ViewWrapper" in content:
                        content = content.replace(": @MainActor ExpoSwiftUI.ViewWrapper", ": ExpoSwiftUI.ViewWrapper")
                        print(f"Applied fallback replacement for @MainActor ViewWrapper in {path}")
                    
                    if content != original_content:
                        with open(path, "w", encoding="utf-8") as f:
                            f.write(content)
                        print(f"Successfully wrote patched @MainActor in {path}")
                except Exception as e:
                    print(f"Error patching @MainActor in {path}: {e}")

# 9. Fix iOS 26.0 contentType API usage in expo-image-picker
print("Patching MediaHandler.swift in expo-image-picker...")
media_handler_path = os.path.join("node_modules", "expo-image-picker", "ios", "MediaHandler.swift")
if os.path.exists(media_handler_path):
    try:
        with open(media_handler_path, "r", encoding="utf-8") as f:
            content = f.read()
        
        target_1 = """  private func getMimeType(from asset: PHAsset?, fileExtension: String) -> String? {
    let utType: UTType? = if #available(iOS 26.0, *) {
      asset?.contentType ?? UTType(filenameExtension: fileExtension)
    } else {
      UTType(filenameExtension: fileExtension)
    }
    return utType?.preferredMIMEType
  }"""
        replacement_1 = """  private func getMimeType(from asset: PHAsset?, fileExtension: String) -> String? {
    let utType: UTType? = UTType(filenameExtension: fileExtension)
    return utType?.preferredMIMEType
  }"""

        target_2 = """  private func getMimeType(from resource: PHAssetResource, fileExtension: String) -> String? {
    let utType: UTType? = if #available(iOS 26.0, *) {
      resource.contentType
    } else {
      UTType(resource.uniformTypeIdentifier) ?? UTType(filenameExtension: fileExtension)
    }
    return utType?.preferredMIMEType
  }"""
        replacement_2 = """  private func getMimeType(from resource: PHAssetResource, fileExtension: String) -> String? {
    let utType: UTType? = UTType(resource.uniformTypeIdentifier) ?? UTType(filenameExtension: fileExtension)
    return utType?.preferredMIMEType
  }"""

        if target_1 in content or target_2 in content:
            content = content.replace(target_1, replacement_1)
            content = content.replace(target_2, replacement_2)
            with open(media_handler_path, "w", encoding="utf-8") as f:
                f.write(content)
            print(f"Successfully patched {media_handler_path}")
    except Exception as e:
        print(f"Error patching {media_handler_path}: {e}")
