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
    namespace = "com.ebot.goldchase"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.ebot.goldchase"
        minSdk = 26
        targetSdk = 36
        versionCode = (project.findProperty("ebotVersionCode") as String?)?.toInt() ?: 1
        versionName = (project.findProperty("ebotVersionName") as String?) ?: "1.0.0"
        buildConfigField("String", "PLAY_LICENSE_KEY", "\"${project.findProperty("ebotPlayLicenseKey") ?: ""}\"")
    }

    signingConfigs {
        create("release") {
            val store = signing("storeFile", "EBOT_KEYSTORE")
            if (store != null) {
                storeFile = rootProject.file(store)
                storePassword = signing("storePassword", "EBOT_KEYSTORE_PASSWORD")
                keyAlias = signing("keyAlias", "EBOT_KEY_ALIAS")
                keyPassword = signing("keyPassword", "EBOT_KEY_PASSWORD")
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
    implementation("com.android.billingclient:billing:9.1.0")
    implementation("androidx.webkit:webkit:1.17.1")
    implementation("androidx.activity:activity:1.13.0")
    implementation("androidx.core:core:1.17.0")
}

// The game itself is the web build (ebot-run/web/dist), packaged as app assets.
val syncWebAssets by tasks.registering(Sync::class) {
    val dist = rootProject.file("../web/dist")
    from(dist)
    into(layout.projectDirectory.dir("src/main/assets/www"))
    doFirst {
        require(dist.resolve("index.html").exists()) {
            "Web build missing. Run: cd ebot-run/web && npm ci && npm run build"
        }
    }
}
tasks.named("preBuild") { dependsOn(syncWebAssets) }
