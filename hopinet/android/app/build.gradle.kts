import java.util.Properties

plugins {
    id("com.android.application")
}

// Release signing comes from keystore.properties (not committed) or environment variables.
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
fun signing(key: String, env: String): String? = keystoreProps.getProperty(key) ?: System.getenv(env)

android {
    namespace = "com.elevo.hopinet"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.elevo.hopinet"
        minSdk = 26
        targetSdk = 36
        versionCode = (project.findProperty("hopinetVersionCode") as String?)?.toInt() ?: 113
        versionName = (project.findProperty("hopinetVersionName") as String?) ?: "3.1.2.5.5.6"
        buildConfigField("String", "PLAY_LICENSE_KEY", "\"${project.findProperty("hopinetPlayLicenseKey") ?: ""}\"")
    }

    // Two editions of the same game:
    //   play = real Google Play purchases (com.elevo.hopinet)
    //   free = no billing library, no BILLING permission, nothing to buy (com.elevo.hopinet.free)
    flavorDimensions += "edition"
    productFlavors {
        create("play") {
            dimension = "edition"
        }
        create("free") {
            dimension = "edition"
            applicationIdSuffix = ".free"
            versionNameSuffix = "-free"
        }
    }

    signingConfigs {
        create("release") {
            val store = signing("storeFile", "HOPINET_KEYSTORE")
            if (store != null) {
                storeFile = rootProject.file(store)
                storePassword = signing("storePassword", "HOPINET_KEYSTORE_PASSWORD")
                keyAlias = signing("keyAlias", "HOPINET_KEY_ALIAS")
                keyPassword = signing("keyPassword", "HOPINET_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            val rel = signingConfigs.getByName("release")
            if (rel.storeFile != null) signingConfig = rel
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    bundle {
        // The game switches language in-app, so every language must ship in every split.
        language { enableSplit = false }
    }
}

dependencies {
    // Real billing exists only in the "play" edition.
    "playImplementation"("com.android.billingclient:billing:9.1.0")
    implementation("androidx.webkit:webkit:1.17.1")
    implementation("androidx.activity:activity:1.13.0")
    implementation("androidx.core:core:1.17.0")
}

if ((project.findProperty("hopinetPlayLicenseKey") as String?).isNullOrBlank()) {
    logger.warn("hopinetPlayLicenseKey is empty: purchase signatures are not verified on the device (play edition). " +
        "Paste the Base64 key from Play Console (Monetize > Monetization setup) into android/gradle.properties.")
}

// The game itself is the web build (web/dist), packaged as app assets.
// The check is its own task because Sync is skipped (NO-SOURCE) when the folder is missing or empty.
val webDist = rootProject.file("../web/dist")
val checkWebBuild by tasks.registering {
    doLast {
        if (!webDist.resolve("index.html").exists() || !webDist.resolve("game.js").exists()) {
            throw GradleException("Web build missing. Run ./build.sh (or: cd web && npm ci && npm run build) first.")
        }
    }
}
val syncWebAssets by tasks.registering(Sync::class) {
    dependsOn(checkWebBuild)
    from(webDist)
    into(layout.projectDirectory.dir("src/main/assets/www"))
}
tasks.named("preBuild") { dependsOn(syncWebAssets) }
