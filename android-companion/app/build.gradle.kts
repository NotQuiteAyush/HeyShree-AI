plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

val releaseKeystore = System.getenv("SHREE_ANDROID_KEYSTORE")
val releaseStorePassword = System.getenv("SHREE_ANDROID_STORE_PASSWORD")
val releaseKeyPassword = System.getenv("SHREE_ANDROID_KEY_PASSWORD")
val hasReleaseSigning = !releaseKeystore.isNullOrBlank() && !releaseStorePassword.isNullOrBlank() && !releaseKeyPassword.isNullOrBlank()

android {
    namespace = "ai.shree.companion"
    compileSdk = 35
    defaultConfig {
        applicationId = "ai.shree.companion"
        minSdk = 29
        targetSdk = 35
        versionCode = 1158
        versionName = "1.1.53"
    }
    buildFeatures { compose = true; buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    signingConfigs {
        if (hasReleaseSigning) create("release") {
            storeFile = file(releaseKeystore!!)
            storePassword = releaseStorePassword
            keyAlias = "shree-companion"
            keyPassword = releaseKeyPassword
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (hasReleaseSigning) signingConfig = signingConfigs.getByName("release")
        }
    }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
    sourceSets["main"].res.srcDir(layout.buildDirectory.dir("generated/res/shreeBrand"))
}

kotlin { jvmToolchain(17) }

val prepareShreeBranding by tasks.registering(Copy::class) {
    from(rootProject.file("../src/assets/branding/shree-mark.png"))
    from(rootProject.file("../src/assets/images/shree_hologram_1782572590362.jpg"))
    into(layout.buildDirectory.dir("generated/res/shreeBrand/drawable-nodpi"))
    rename("shree-mark.png", "shree_mark.png")
    rename("shree_hologram_1782572590362.jpg", "shree_hologram.jpg")
}
tasks.configureEach { if (name == "preBuild") dependsOn(prepareShreeBranding) }

dependencies {
    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation("androidx.activity:activity-compose:1.10.0")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.1")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
    testImplementation("junit:junit:4.13.2")
}
