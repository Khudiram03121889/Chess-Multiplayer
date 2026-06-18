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
                
                # 1. Check and downgrade swift-tools-version if greater than 6.1
                match = re.match(r"^//\s*swift-tools-version:\s*([\d\.]+)", content)
                if match:
                    version = match.group(1)
                    parts = version.split('.')
                    if len(parts) >= 2:
                        try:
                            major, minor = int(parts[0]), int(parts[1])
                            if major > 6 or (major == 6 and minor > 0):
                                print(f"Downgrading tools-version in {path} from {version} to 6.0")
                                content = re.sub(
                                    r"^//\s*swift-tools-version:\s*[\d\.]+",
                                    "// swift-tools-version: 6.0",
                                    content
                                )
                                modified = True
                        except ValueError:
                            pass
                
                # 1.5. Clean trailing commas in function/initializer calls for Swift 6.0 compatibility
                new_content = re.sub(r',\s*\)', ')', content)
                if new_content != content:
                    print(f"Stripped trailing commas in {path}")
                    content = new_content
                    modified = True
                
                # 2. Pin apple/swift-collections to 1.1.4 (compatible with Swift 6.1)
                if "swift-collections" in content and "1.1.4" not in content:
                    print(f"Pinning swift-collections in {path}")
                    content = re.sub(
                        r'\.package\(url:\s*["\']https://github.com/apple/swift-collections(?:\.git)?["\']\s*,\s*[^)]+\)',
                        '.package(url: "https://github.com/apple/swift-collections.git", exact: "1.1.4")',
                        content
                    )
                    modified = True
                
                # 3. Pin apple/swift-syntax to 600.0.1 (compatible with Swift 6.0/6.1)
                if "swift-syntax" in content and "600.0.1" not in content:
                    print(f"Pinning swift-syntax in {path}")
                    content = re.sub(
                        r'\.package\(url:\s*["\']https://github.com/apple/swift-syntax(?:\.git)?["\']\s*,\s*[^)]+\)',
                        '.package(url: "https://github.com/apple/swift-syntax.git", exact: "600.0.1")',
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
                if "JavaScriptRuntime.swift" in path and "vector.push_back(consuming: propNameId)" in content:
                    content = content.replace("vector.push_back(consuming: propNameId)", "vector.push_back(propNameId)")
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

